import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  fetchMovieDetails,
  fetchTvDetails,
  imageUrl,
  isTmdbEnabled,
  searchCatalog,
  type CatalogHit,
} from "../artwork/tmdb";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { tmdbDetails, watchlist } from "../db/schema";
import { LibraryService } from "../library/library.service";
import { logger } from "../logger";
import {
  pickUpcomingMovie,
  pickUpcomingTv,
  todayStamp,
  unwrapTvDetails,
  type UpcomingKind,
  type UpcomingPick,
} from "./upcoming";

const log = logger.child({ component: "watchlist" });
const DETAILS_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_POOL = 4;

export interface WatchlistItem {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  posterUrl: string | null;
  addedAt: string;
}

export interface UpcomingItem {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  posterUrl: string | null;
  airDate: string;
  kind: UpcomingKind;
  seasonNumber: number | null;
  episodeNumber: number | null;
  subtitle: string;
  source: "library" | "watchlist";
}

export interface SearchHit extends CatalogHit {
  posterUrl: string | null;
  onWatchlist: boolean;
}

type DetailsPayload = {
  title: string;
  posterPath: string | null;
  tv?: Parameters<typeof pickUpcomingTv>[0];
  movie?: Parameters<typeof pickUpcomingMovie>[0];
};

type TitleRef = {
  tmdbType: "tv" | "movie";
  tmdbId: number;
  title: string;
  posterPath: string | null;
  source: "library" | "watchlist";
};

@Injectable()
export class WatchlistService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LibraryService) private readonly library: LibraryService
  ) {}

  list(): WatchlistItem[] {
    return this.db
      .select()
      .from(watchlist)
      .orderBy(desc(watchlist.addedAt))
      .all()
      .map(toWatchlistItem);
  }

  add(input: {
    tmdbType: "tv" | "movie";
    tmdbId: number;
    title: string;
    posterPath?: string | null;
  }): WatchlistItem {
    const now = new Date();
    const title = input.title.trim();
    this.db
      .insert(watchlist)
      .values({
        tmdbType: input.tmdbType,
        tmdbId: input.tmdbId,
        title,
        posterPath: input.posterPath ?? null,
        addedAt: now,
      })
      .onConflictDoUpdate({
        target: [watchlist.tmdbType, watchlist.tmdbId],
        set: { title, posterPath: input.posterPath ?? null, addedAt: now },
      })
      .run();
    return {
      tmdbId: input.tmdbId,
      tmdbType: input.tmdbType,
      title,
      posterUrl: imageUrl(input.posterPath, "w500"),
      addedAt: now.toISOString(),
    };
  }

  remove(tmdbType: "tv" | "movie", tmdbId: number): { removed: boolean } {
    const deleted = this.db
      .delete(watchlist)
      .where(and(eq(watchlist.tmdbType, tmdbType), eq(watchlist.tmdbId, tmdbId)))
      .run();
    return { removed: (deleted.changes ?? 0) > 0 };
  }

  async search(query: string): Promise<{ items: SearchHit[]; tmdbEnabled: boolean }> {
    const enabled = isTmdbEnabled();
    const trimmed = query.trim();
    if (!trimmed || !enabled) return { items: [], tmdbEnabled: enabled };
    const saved = new Set(this.list().map((item) => `${item.tmdbType}:${item.tmdbId}`));
    const items = (await searchCatalog(trimmed)).map((hit) => ({
      ...hit,
      posterUrl: imageUrl(hit.posterPath, "w500"),
      onWatchlist: saved.has(`${hit.tmdbType}:${hit.tmdbId}`),
    }));
    return { items, tmdbEnabled: true };
  }

  async upcoming(): Promise<{ items: UpcomingItem[]; tmdbEnabled: boolean }> {
    if (!isTmdbEnabled()) return { items: [], tmdbEnabled: false };

    const saved = this.list();
    const library = await this.library.list({ view: "titles", status: "in_progress", limit: 300 });
    const refs = new Map<string, TitleRef>();

    for (const card of library.items) {
      const tmdbId = card.artwork?.tmdbId;
      const tmdbType =
        card.artwork?.tmdbType === "movie" || card.artwork?.tmdbType === "tv"
          ? card.artwork.tmdbType
          : null;
      if (!tmdbId || !tmdbType) continue;
      const key = `${tmdbType}:${tmdbId}`;
      if (refs.has(key)) continue;
      refs.set(key, {
        tmdbType,
        tmdbId,
        title: card.showTitle ?? card.title ?? String(tmdbId),
        posterPath: posterPathFromUrl(card.artwork?.posterUrl),
        source: "library",
      });
    }
    for (const item of saved) {
      const key = `${item.tmdbType}:${item.tmdbId}`;
      const existing = refs.get(key);
      if (existing) {
        existing.source = "watchlist";
        continue;
      }
      refs.set(key, {
        tmdbType: item.tmdbType,
        tmdbId: item.tmdbId,
        title: item.title,
        posterPath: posterPathFromUrl(item.posterUrl),
        source: "watchlist",
      });
    }

    const entries = [...refs.values()];
    const details = await mapPool(entries, FETCH_POOL, (ref) => this.loadDetails(ref));
    const items: UpcomingItem[] = [];
    for (let i = 0; i < entries.length; i++) {
      const ref = entries[i]!;
      const pick = details[i];
      if (!pick) continue;
      items.push({
        tmdbId: ref.tmdbId,
        tmdbType: ref.tmdbType,
        title: ref.title,
        posterUrl: imageUrl(ref.posterPath, "w500") ?? imageUrl(pickPoster(pick, ref), "w500"),
        airDate: pick.airDate,
        kind: pick.kind,
        seasonNumber: pick.seasonNumber,
        episodeNumber: pick.episodeNumber,
        subtitle: pick.subtitle,
        source: ref.source,
      });
    }
    items.sort((a, b) => a.airDate.localeCompare(b.airDate) || a.title.localeCompare(b.title));
    return { items, tmdbEnabled: true };
  }

  private async loadDetails(ref: TitleRef): Promise<(UpcomingPick & { posterPath?: string | null }) | null> {
    const cacheKey = `${ref.tmdbType}:${ref.tmdbId}`;
    const cached = this.db.select().from(tmdbDetails).where(eq(tmdbDetails.cacheKey, cacheKey)).all()[0];
    const fresh = cached && Date.now() - cached.updatedAt.getTime() < DETAILS_TTL_MS;
    let payload: DetailsPayload | null = fresh ? asPayload(cached!.payload) : null;
    if (!payload) {
      try {
        payload = await this.fetchPayload(ref);
        if (payload) {
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
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err), cacheKey }, "TMDB details failed");
        payload = cached ? asPayload(cached.payload) : null;
      }
    }
    if (!payload) return null;
    const today = todayStamp();
    const pick =
      ref.tmdbType === "tv" && payload.tv
        ? pickUpcomingTv(payload.tv, today)
        : ref.tmdbType === "movie" && payload.movie
          ? pickUpcomingMovie(payload.movie, today)
          : null;
    if (!pick) return null;
    return { ...pick, posterPath: payload.posterPath };
  }

  private async fetchPayload(ref: TitleRef): Promise<DetailsPayload | null> {
    if (ref.tmdbType === "tv") {
      const tv = await fetchTvDetails(ref.tmdbId);
      if (!tv) return null;
      return { title: tv.name || ref.title, posterPath: tv.poster_path ?? ref.posterPath, tv };
    }
    const movie = await fetchMovieDetails(ref.tmdbId);
    if (!movie) return null;
    return { title: movie.title || ref.title, posterPath: movie.poster_path ?? ref.posterPath, movie };
  }
}

function toWatchlistItem(row: typeof watchlist.$inferSelect): WatchlistItem {
  return {
    tmdbId: row.tmdbId,
    tmdbType: row.tmdbType as "tv" | "movie",
    title: row.title,
    posterUrl: imageUrl(row.posterPath, "w500"),
    addedAt: row.addedAt.toISOString(),
  };
}

function posterPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/t/p/w500";
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : null;
}

function asPayload(value: unknown): DetailsPayload | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as DetailsPayload;
  if (obj.movie) return obj;
  const tv = unwrapTvDetails(value);
  if (!tv) return obj.tv ? obj : null;
  return { title: tv.name || obj.title, posterPath: tv.poster_path ?? obj.posterPath, tv };
}

function pickPoster(
  pick: UpcomingPick & { posterPath?: string | null },
  ref: TitleRef
): string | null {
  return pick.posterPath ?? ref.posterPath;
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
