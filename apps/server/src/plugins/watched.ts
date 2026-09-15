import { and, eq } from "drizzle-orm";
import { titleCacheKey } from "../artwork/artwork.service";
import { config } from "../config";
import type { Db } from "../db/client";
import { artwork, exportMarks, libraryOverrides, providerObservations, tmdbDetails, watchlist } from "../db/schema";
import { aggregateObservations, contentIdentityKey } from "../library/aggregate";
import { applyOverride, overrideMap } from "../library/overrides";
import { parseTmdbWatchKey } from "../shows/progress";
import { unwrapTvDetails } from "../watchlist/upcoming";
import type { WatchMark } from "./plugin";

export function pendingWatched(db: Db, sink: string): WatchMark[] {
  const observations = db.select().from(providerObservations).all();
  const items = aggregateObservations(observations, config.WATCHED_THRESHOLD_PERCENT);
  const overrideRows = db.select().from(libraryOverrides).all();
  const overrides = overrideMap(overrideRows);
  const already = new Set(
    db.select().from(exportMarks).where(eq(exportMarks.sink, sink)).all().map((row) => row.contentKey)
  );

  const pending: WatchMark[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.mediaType !== "movie" && item.mediaType !== "episode") continue;
    const key = contentIdentityKey(item);
    if (already.has(key)) continue;
    const searchTitle = item.mediaType === "episode" ? (item.showTitle ?? undefined) : (item.title ?? undefined);
    const cacheKey = titleCacheKey({ mediaType: item.mediaType, searchTitle });
    const art = cacheKey ? db.select().from(artwork).where(eq(artwork.cacheKey, cacheKey)).get() : undefined;
    const completed = applyOverride(
      item,
      overrides,
      art?.tmdbId && art.tmdbType ? { id: art.tmdbId, type: art.tmdbType } : null
    );
    if (!completed.completed) continue;
    pending.push({
      key,
      mediaType: item.mediaType,
      title: item.title ?? undefined,
      showTitle: item.showTitle ?? undefined,
      seasonNumber: item.seasonNumber ?? undefined,
      episodeNumber: item.episodeNumber ?? undefined,
      tmdbId: art?.tmdbId ?? null,
      year: art?.year ?? null,
    });
    seen.add(dupKey(item.mediaType, art?.tmdbId, item.seasonNumber, item.episodeNumber));
  }

  for (const row of overrideRows) {
    if (row.action !== "watched") continue;
    const parsed = parseTmdbWatchKey(row.key);
    if (!parsed || already.has(row.key)) continue;

    if (parsed.kind === "movie") {
      if (seen.has(dupKey("movie", parsed.tmdbId))) continue;
      const { title, year } = tmdbTitle(db, "movie", parsed.tmdbId);
      if (!title) continue;
      pending.push({ key: row.key, mediaType: "movie", title, tmdbId: parsed.tmdbId, year });
      seen.add(dupKey("movie", parsed.tmdbId));
      continue;
    }

    let season: number | undefined;
    let episode: number | undefined;
    if (parsed.kind === "tv-episode") {
      season = parsed.season;
      episode = parsed.episode;
    } else if (parsed.kind === "tv-season") {
      const last = lastEpisodeInSeason(db, parsed.tmdbId, parsed.season);
      if (last == null) continue;
      season = parsed.season;
      episode = last;
    } else {
      continue;
    }

    if (seen.has(dupKey("episode", parsed.tmdbId, season, episode))) continue;
    const { title, year } = tmdbTitle(db, "tv", parsed.tmdbId);
    if (!title) continue;
    pending.push({
      key: row.key,
      mediaType: "episode",
      title,
      showTitle: title,
      seasonNumber: season,
      episodeNumber: episode,
      tmdbId: parsed.tmdbId,
      year,
    });
    seen.add(dupKey("episode", parsed.tmdbId, season, episode));
  }

  return pending;
}

function dupKey(
  mediaType: string,
  tmdbId?: number | null,
  season?: number | null,
  episode?: number | null
): string {
  return `${mediaType}:${tmdbId ?? ""}:${season ?? ""}:${episode ?? ""}`;
}

function tmdbTitle(db: Db, type: "tv" | "movie", tmdbId: number): { title: string; year: number | null } {
  const followed = db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.tmdbType, type), eq(watchlist.tmdbId, tmdbId)))
    .get();
  if (followed?.title) return { title: followed.title, year: null };

  const art = db
    .select()
    .from(artwork)
    .where(eq(artwork.tmdbId, tmdbId))
    .all()
    .find((row) => row.tmdbType === type && row.title);
  if (art?.title) return { title: art.title, year: art.year ?? null };

  const cached = db
    .select()
    .from(tmdbDetails)
    .where(eq(tmdbDetails.cacheKey, `${type}:${tmdbId}`))
    .get();
  if (type === "tv") {
    const tv = unwrapTvDetails(cached?.payload);
    if (tv?.name) return { title: tv.name, year: yearFromDate(tv.first_air_date) };
  } else if (cached?.payload && typeof cached.payload === "object") {
    const movie = cached.payload as { title?: unknown; release_date?: unknown };
    if (typeof movie.title === "string") {
      return {
        title: movie.title,
        year: yearFromDate(typeof movie.release_date === "string" ? movie.release_date : null),
      };
    }
  }
  return { title: "", year: null };
}

function lastEpisodeInSeason(db: Db, tmdbId: number, season: number): number | null {
  const row = db
    .select()
    .from(tmdbDetails)
    .where(eq(tmdbDetails.cacheKey, `tv:${tmdbId}:season:${season}`))
    .get();
  const episodes = row?.payload && typeof row.payload === "object" ? (row.payload as { episodes?: unknown }).episodes : null;
  if (!Array.isArray(episodes)) return null;
  let max = 0;
  for (const ep of episodes) {
    if (!ep || typeof ep !== "object") continue;
    const n = (ep as { episode_number?: unknown }).episode_number;
    if (typeof n === "number" && n > max) max = n;
  }
  return max > 0 ? max : null;
}

function yearFromDate(value?: string | null): number | null {
  if (!value || value.length < 4) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function persistMarks(db: Db, sink: string, marked: Array<{ key: string; remoteId: string }>): void {
  const now = new Date();
  for (const row of marked) {
    db.insert(exportMarks)
      .values({ sink, contentKey: row.key, remoteId: row.remoteId, exportedAt: now })
      .onConflictDoUpdate({
        target: [exportMarks.sink, exportMarks.contentKey],
        set: { remoteId: row.remoteId, exportedAt: now },
      })
      .run();
  }
}
