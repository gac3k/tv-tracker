import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  fetchSeason,
  fetchTvDetails,
  imageUrl,
  isTmdbEnabled,
  type TmdbSeasonDetails,
  type TmdbTvDetails,
} from "../artwork/tmdb";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { libraryOverrides, tmdbDetails } from "../db/schema";
import { LibraryService } from "../library/library.service";
import { overrideMap } from "../library/overrides";
import { logger } from "../logger";
import { WatchlistService } from "../watchlist/watchlist.service";
import { todayStamp, unwrapTvDetails } from "../watchlist/upcoming";
import {
  applyProgressMark,
  compactWatchKeys,
  isTvOverrideKey,
  tmdbMovieKey,
  watchedFromOverrides,
  type CatalogSeason,
  type ProgressMark,
} from "./progress";

const log = logger.child({ component: "shows" });
const DETAILS_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_POOL = 4;

export interface ShowListItem {
  key: string;
  tmdbId: number | null;
  tmdbType: "tv" | "movie" | null;
  title: string;
  posterUrl: string | null;
  providers: string[];
  sources: Array<"library" | "watchlist">;
  progress: string | null;
  canCatchUp: boolean;
}

export interface ShowEpisode {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  stillUrl: string | null;
  aired: boolean;
  watched: boolean;
  locked: boolean;
}

export interface ShowSeason {
  seasonNumber: number;
  name: string;
  watched: number;
  total: number;
  userMarked: boolean;
  episodes: ShowEpisode[];
}

export interface ShowCatalog {
  tmdbId: number;
  tmdbType: "tv";
  title: string;
  posterUrl: string | null;
  following: boolean;
  seasons: ShowSeason[];
}

@Injectable()
export class ShowsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(WatchlistService) private readonly watchlist: WatchlistService
  ) {}

  async list(): Promise<{ items: ShowListItem[]; tmdbEnabled: boolean }> {
    const followed = this.watchlist.list();
    const library = await this.library.list({
      view: "titles",
      mediaType: "episode",
      status: "in_progress",
      limit: 300,
    });
    const items = new Map<string, ShowListItem>();

    for (const card of library.items) {
      const tmdbId = card.artwork?.tmdbId ?? null;
      const tmdbType =
        card.artwork?.tmdbType === "tv" || card.artwork?.tmdbType === "movie"
          ? card.artwork.tmdbType
          : null;
      const key = tmdbId && tmdbType ? `${tmdbType}:${tmdbId}` : `lib:${card.key}`;
      items.set(key, {
        key,
        tmdbId,
        tmdbType,
        title: card.showTitle ?? card.title ?? card.providerContentId,
        posterUrl: card.artwork?.posterUrl ?? null,
        providers: card.providers?.length ? card.providers : [card.provider],
        sources: ["library"],
        progress: progressLabel(card.seasonNumber, card.episodeNumber),
        canCatchUp: tmdbType === "tv" && tmdbId != null,
      });
    }

    for (const item of followed) {
      const key = `${item.tmdbType}:${item.tmdbId}`;
      const existing = items.get(key);
      if (existing) {
        existing.sources = ["library", "watchlist"];
        continue;
      }
      items.set(key, {
        key,
        tmdbId: item.tmdbId,
        tmdbType: item.tmdbType,
        title: item.title,
        posterUrl: item.posterUrl,
        providers: [],
        sources: ["watchlist"],
        progress: "Followed",
        canCatchUp: item.tmdbType === "tv",
      });
    }

    return { items: [...items.values()], tmdbEnabled: isTmdbEnabled() };
  }

  async catalog(tmdbId: number): Promise<ShowCatalog> {
    const tv = await this.loadTv(tmdbId);
    if (!tv) throw new NotFoundException();
    const seasons = await this.loadSeasons(tmdbId, tv);
    const overrides = overrideMap(this.db.select().from(libraryOverrides).all());
    const marked = watchedFromOverrides(tmdbId, toCatalog(seasons), overrides);
    const observed = await this.observedCompleted(tmdbId);
    const today = todayStamp();
    const following = this.watchlist.list().some((item) => item.tmdbType === "tv" && item.tmdbId === tmdbId);

    return {
      tmdbId,
      tmdbType: "tv",
      title: tv.name,
      posterUrl: imageUrl(tv.poster_path, "w500"),
      following,
      seasons: seasons.map((season) => {
        const episodes: ShowEpisode[] = season.episodes.map((ep) => {
          const id = `${season.season_number}:${ep.episode_number}`;
          const locked = observed.has(id);
          const userMarked = marked.has(id);
          return {
            episodeNumber: ep.episode_number,
            name: ep.name?.trim() || `Episode ${ep.episode_number}`,
            airDate: ep.air_date,
            stillUrl: imageUrl(ep.still_path, "w300"),
            aired: Boolean(ep.air_date && ep.air_date <= today),
            watched: locked || userMarked,
            locked,
          };
        });
        return {
          seasonNumber: season.season_number,
          name: season.name?.trim() || `Season ${season.season_number}`,
          watched: episodes.filter((ep) => ep.watched).length,
          total: episodes.length,
          userMarked: episodes.some((ep) => marked.has(`${season.season_number}:${ep.episodeNumber}`)),
          episodes,
        };
      }),
    };
  }

  async progress(
    tmdbType: "tv" | "movie",
    tmdbId: number,
    body: { mark: string; season?: number; episode?: number; watched?: boolean }
  ): Promise<{ updated: number }> {
    if (tmdbType === "movie") {
      if (body.mark !== "watched" && body.mark !== "caught_up") {
        return { updated: 0 };
      }
      const on = body.watched !== false;
      this.library.applyActions(on ? "watched" : "restore", [tmdbMovieKey(tmdbId)]);
      return { updated: 1 };
    }

    const catalog = await this.catalogSeasons(tmdbId);
    if (!catalog) throw new NotFoundException();
    const overrides = overrideMap(this.db.select().from(libraryOverrides).all());
    const current = watchedFromOverrides(tmdbId, catalog, overrides);
    const mark = toMark(body);
    if (!mark) return { updated: 0 };
    const next = applyProgressMark(catalog, current, mark);
    return { updated: this.replaceTvKeys(tmdbId, compactWatchKeys(tmdbId, catalog, next)) };
  }

  private async catalogSeasons(tmdbId: number): Promise<CatalogSeason[] | null> {
    const tv = await this.loadTv(tmdbId);
    if (!tv) return null;
    return toCatalog(await this.loadSeasons(tmdbId, tv));
  }

  private replaceTvKeys(tmdbId: number, keys: string[]): number {
    const stale = this.db
      .select()
      .from(libraryOverrides)
      .all()
      .map((row) => row.key)
      .filter((key) => isTvOverrideKey(key, tmdbId));
    if (stale.length) this.library.applyActions("restore", stale);
    if (keys.length) this.library.applyActions("watched", keys);
    return keys.length;
  }

  private async observedCompleted(tmdbId: number): Promise<Set<string>> {
    const library = await this.library.list({
      view: "episodes",
      mediaType: "episode",
      limit: 10_000,
    });
    const set = new Set<string>();
    for (const card of library.items) {
      if (card.artwork?.tmdbId !== tmdbId || card.artwork.tmdbType !== "tv") continue;
      if (!card.completed) continue;
      if (card.seasonNumber == null || card.episodeNumber == null) continue;
      set.add(`${card.seasonNumber}:${card.episodeNumber}`);
    }
    return set;
  }

  private async loadTv(tmdbId: number): Promise<TmdbTvDetails | null> {
    if (!isTmdbEnabled()) return null;
    const cacheKey = `tv:${tmdbId}`;
    const cached = this.readCache(cacheKey);
    if (cached?.fresh) {
      const tv = unwrapTvDetails(cached.payload);
      if (tv) return tv;
    }
    try {
      const tv = await fetchTvDetails(tmdbId);
      if (tv) this.writeCache(cacheKey, tv);
      return tv ?? unwrapTvDetails(cached?.payload);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), tmdbId }, "TMDB show failed");
      return unwrapTvDetails(cached?.payload);
    }
  }

  private async loadSeasons(tmdbId: number, tv: TmdbTvDetails): Promise<TmdbSeasonDetails[]> {
    const numbers = [...new Set(tv.seasons.map((season) => season.season_number))]
      .filter((n) => n >= 0)
      .sort((a, b) => {
        if (a === 0) return 1;
        if (b === 0) return -1;
        return a - b;
      });
    const fetched = await mapPool(numbers, FETCH_POOL, (season) => this.loadSeason(tmdbId, season));
    return fetched.filter((row): row is TmdbSeasonDetails => row != null && row.episodes.length > 0);
  }

  private async loadSeason(tmdbId: number, season: number): Promise<TmdbSeasonDetails | null> {
    const cacheKey = `tv:${tmdbId}:season:${season}`;
    const cached = this.readCache(cacheKey);
    if (cached?.fresh && isSeasonPayload(cached.payload)) return cached.payload;
    try {
      const data = await fetchSeason(tmdbId, season);
      if (data) this.writeCache(cacheKey, data);
      return data ?? (isSeasonPayload(cached?.payload) ? cached.payload : null);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), tmdbId, season },
        "TMDB season failed"
      );
      return isSeasonPayload(cached?.payload) ? cached.payload : null;
    }
  }

  private readCache(cacheKey: string): { payload: unknown; fresh: boolean } | null {
    const row = this.db.select().from(tmdbDetails).where(eq(tmdbDetails.cacheKey, cacheKey)).all()[0];
    if (!row) return null;
    return {
      payload: row.payload,
      fresh: Date.now() - row.updatedAt.getTime() < DETAILS_TTL_MS,
    };
  }

  private writeCache(cacheKey: string, payload: unknown): void {
    const now = new Date();
    this.db
      .insert(tmdbDetails)
      .values({ cacheKey, payload, updatedAt: now })
      .onConflictDoUpdate({
        target: tmdbDetails.cacheKey,
        set: { payload, updatedAt: now },
      })
      .run();
  }
}

function progressLabel(season: number | null, episode: number | null): string | null {
  if (season == null || episode == null) return "Watching";
  return `S${season}·E${episode}`;
}

function toCatalog(seasons: TmdbSeasonDetails[]): CatalogSeason[] {
  return seasons.map((season) => ({
    season: season.season_number,
    episodes: season.episodes.map((ep) => ({
      season: season.season_number,
      episode: ep.episode_number,
      airDate: ep.air_date,
    })),
  }));
}

function toMark(body: {
  mark: string;
  season?: number;
  episode?: number;
  watched?: boolean;
}): ProgressMark | null {
  if (body.mark === "caught_up") return { mark: "caught_up", today: todayStamp() };
  if (body.mark === "season" && typeof body.season === "number") {
    return { mark: "season", season: body.season, on: body.watched !== false };
  }
  if (body.mark === "episode" && typeof body.season === "number" && typeof body.episode === "number") {
    return { mark: "episode", season: body.season, episode: body.episode, on: body.watched !== false };
  }
  return null;
}

function isSeasonPayload(value: unknown): value is TmdbSeasonDetails {
  return Boolean(value && typeof value === "object" && "episodes" in value && "season_number" in value);
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return out;
}
