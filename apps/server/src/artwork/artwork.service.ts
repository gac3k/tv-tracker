import { Inject, Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { artwork, type ArtworkRow } from "../db/schema";
import { logger } from "../logger";
import { fetchEpisode, imageUrl, isTmdbEnabled, searchTitle } from "./tmdb";

const log = logger.child({ component: "artwork" });

export interface ArtworkRequest {
  /** Caller-supplied identity; the result map is keyed by this. */
  id: string;
  mediaType: string;
  /** Show name for episodes, film name for movies. */
  searchTitle?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

export interface ResolvedArtwork {
  posterUrl: string | null;
  backdropUrl: string | null;
  stillUrl: string | null;
  tmdbId: number | null;
  tmdbType: string | null;
  /** Canonical runtime, used to derive progress for remaining-time providers. */
  runtimeSeconds: number | null;
}

/** Normalized cache key: strips punctuation/case so "Black Mirror!" == "black mirror". */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function titleCacheKey(req: Pick<ArtworkRequest, "mediaType" | "searchTitle">): string | null {
  const name = req.searchTitle?.trim();
  if (!name) return null;
  const type = req.mediaType === "episode" ? "tv" : "movie";
  return `${type}:${normalize(name)}`;
}

export function episodeCacheKey(tmdbId: number, season: number, episode: number): string {
  return `tv:${tmdbId}:s${season}e${episode}`;
}

function emptyRow(cacheKey: string): Omit<ArtworkRow, "updatedAt"> {
  return {
    cacheKey,
    tmdbId: null,
    tmdbType: null,
    title: null,
    year: null,
    posterPath: null,
    backdropPath: null,
    stillPath: null,
    runtimeSeconds: null,
    notFound: true,
  };
}

@Injectable()
export class ArtworkService {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(@Inject(DB) private readonly db: Db) {}

  get enabled(): boolean {
    return isTmdbEnabled();
  }

  private readCache(keys: string[]): Map<string, ArtworkRow> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return new Map();
    const rows = this.db.select().from(artwork).where(inArray(artwork.cacheKey, unique)).all();
    return new Map(rows.map((row) => [row.cacheKey, row]));
  }

  private writeCache(row: Omit<ArtworkRow, "updatedAt">): ArtworkRow {
    const full = { ...row, updatedAt: new Date() };
    this.db
      .insert(artwork)
      .values(full)
      .onConflictDoUpdate({ target: artwork.cacheKey, set: full })
      .run();
    return full;
  }

  /** Look up (and cache) the show/movie row for one request. */
  private async resolveTitleRow(
    req: ArtworkRequest,
    cache: Map<string, ArtworkRow>
  ): Promise<ArtworkRow | undefined> {
    const key = titleCacheKey(req);
    if (!key) return undefined;
    const cached = cache.get(key);
    if (cached || !this.enabled) return cached;

    const type = req.mediaType === "episode" ? "tv" : "movie";
    try {
      const match = await searchTitle(req.searchTitle!.trim(), type);
      const row = this.writeCache(
        match
          ? {
              cacheKey: key,
              tmdbId: match.tmdbId,
              tmdbType: match.tmdbType,
              title: match.title,
              year: match.year ?? null,
              posterPath: match.posterPath ?? null,
              backdropPath: match.backdropPath ?? null,
              stillPath: null,
              runtimeSeconds: match.runtimeSeconds ?? null,
              notFound: false,
            }
          : emptyRow(key)
      );
      cache.set(key, row);
      return row;
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "TMDB lookup failed");
      return undefined;
    }
  }

  /** Look up (and cache) the episode row, for stills and precise runtime. */
  private async resolveEpisodeRow(
    titleRow: ArtworkRow | undefined,
    req: ArtworkRequest,
    cache: Map<string, ArtworkRow>
  ): Promise<ArtworkRow | undefined> {
    if (
      !titleRow?.tmdbId ||
      titleRow.tmdbType !== "tv" ||
      typeof req.seasonNumber !== "number" ||
      typeof req.episodeNumber !== "number"
    ) {
      return undefined;
    }
    const key = episodeCacheKey(titleRow.tmdbId, req.seasonNumber, req.episodeNumber);
    const cached = cache.get(key);
    if (cached || !this.enabled) return cached;

    try {
      const details = await fetchEpisode(titleRow.tmdbId, req.seasonNumber, req.episodeNumber);
      const row = this.writeCache({
        ...emptyRow(key),
        tmdbId: titleRow.tmdbId,
        tmdbType: "tv",
        stillPath: details?.stillPath ?? null,
        runtimeSeconds: details?.runtimeSeconds ?? null,
        notFound: details === null,
      });
      cache.set(key, row);
      return row;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "TMDB episode lookup failed"
      );
      return undefined;
    }
  }

  /**
   * Resolve artwork for many items at once, keyed by each request's `id`.
   * Cached rows are returned immediately; uncached ones hit TMDB sequentially
   * (well under the rate limit at this scale) and are persisted, negatives included.
   */
  async resolveMany(requests: ArtworkRequest[]): Promise<Map<string, ResolvedArtwork>> {
    const titleCache = this.readCache(
      requests.map(titleCacheKey).filter((k): k is string => k !== null)
    );
    // Episode keys depend on tmdbId, so warm that cache after title rows resolve.
    const episodeCache = new Map<string, ArtworkRow>();
    const out = new Map<string, ResolvedArtwork>();

    for (const req of requests) {
      const titleRow = await this.resolveTitleRow(req, titleCache);
      if (titleRow?.tmdbId && titleRow.tmdbType === "tv" && episodeCache.size === 0) {
        // First TV hit: bulk-load whatever episode rows already exist.
        const keys = requests
          .map((r) => {
            const row = titleCacheKey(r) ? titleCache.get(titleCacheKey(r)!) : undefined;
            return row?.tmdbId &&
              row.tmdbType === "tv" &&
              typeof r.seasonNumber === "number" &&
              typeof r.episodeNumber === "number"
              ? episodeCacheKey(row.tmdbId, r.seasonNumber, r.episodeNumber)
              : null;
          })
          .filter((k): k is string => k !== null);
        for (const [key, row] of this.readCache(keys)) {
          episodeCache.set(key, row);
        }
      }
      const episodeRow = await this.resolveEpisodeRow(titleRow, req, episodeCache);

      out.set(req.id, {
        posterUrl: imageUrl(titleRow?.posterPath, "w500"),
        backdropUrl: imageUrl(titleRow?.backdropPath, "w780"),
        stillUrl: imageUrl(episodeRow?.stillPath, "w500"),
        tmdbId: titleRow?.tmdbId ?? null,
        tmdbType: titleRow?.tmdbType ?? null,
        // Episode runtime beats the show's average when we have it.
        runtimeSeconds: episodeRow?.runtimeSeconds ?? titleRow?.runtimeSeconds ?? null,
      });
    }

    return out;
  }
}
