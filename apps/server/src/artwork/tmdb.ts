/**
 * Minimal TMDB client. Only the three calls the library view needs:
 * search a show/movie, fetch movie runtime, fetch episode still + runtime.
 *
 * TMDB is optional: without TMDB_API_KEY every lookup returns null and the UI
 * falls back to generated placeholder tiles.
 */
import { config } from "../config";

const API = "https://api.themoviedb.org/3";

/** TMDB serves images from a CDN; w500 is the sweet spot for a poster grid. */
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export interface TmdbMatch {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  /** Movies only; episode runtime is fetched separately. */
  runtimeSeconds?: number;
}

export interface TmdbEpisodeDetails {
  stillPath?: string;
  runtimeSeconds?: number;
}

export function isTmdbEnabled(): boolean {
  return Boolean(config.TMDB_API_KEY);
}

async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!config.TMDB_API_KEY) return null;
  const url = new URL(`${API}${path}`);
  url.searchParams.set("api_key", config.TMDB_API_KEY);
  url.searchParams.set("language", config.TMDB_LANGUAGE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    // 404 = no such id; 401 = bad key. Both are "no artwork", not a crash.
    return null;
  }
  return (await res.json()) as T;
}

interface SearchHit {
  id: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
}

interface SearchResult {
  results?: SearchHit[];
}

/** Case/punctuation-insensitive comparison key. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * TMDB orders search results by popularity, so a query for "Inside Out" returns
 * "Inside Out 2" first. Prefer a result whose (localized or original) title is
 * an exact match; otherwise keep TMDB's own ordering.
 */
export function pickBestHit(query: string, hits: SearchHit[]): SearchHit | undefined {
  const target = normalize(query);
  const exact = hits.find(
    (hit) =>
      normalize(hit.title ?? hit.name ?? "") === target ||
      normalize(hit.original_title ?? hit.original_name ?? "") === target
  );
  return exact ?? hits[0];
}

function yearOf(date: string | undefined): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : undefined;
}

/** Search TMDB for a show (type "tv") or a film (type "movie"). */
export async function searchTitle(
  query: string,
  type: "tv" | "movie"
): Promise<TmdbMatch | null> {
  const data = await get<SearchResult>(`/search/${type}`, { query, include_adult: "false" });
  const hit = pickBestHit(query, data?.results ?? []);
  if (!hit) return null;

  const match: TmdbMatch = {
    tmdbId: hit.id,
    tmdbType: type,
    title: (hit.name ?? hit.title ?? query).trim(),
    year: yearOf(hit.first_air_date ?? hit.release_date),
    posterPath: hit.poster_path ?? undefined,
    backdropPath: hit.backdrop_path ?? undefined,
  };

  if (type === "movie") {
    const details = await get<{ runtime?: number | null }>(`/movie/${hit.id}`, {});
    if (typeof details?.runtime === "number" && details.runtime > 0) {
      match.runtimeSeconds = details.runtime * 60;
    }
  }
  return match;
}

/** Episode still + runtime, used for derived progress on remaining-time providers. */
export async function fetchEpisode(
  tmdbId: number,
  season: number,
  episode: number
): Promise<TmdbEpisodeDetails | null> {
  const data = await get<{ still_path?: string | null; runtime?: number | null }>(
    `/tv/${tmdbId}/season/${season}/episode/${episode}`,
    {}
  );
  if (!data) return null;
  return {
    stillPath: data.still_path ?? undefined,
    runtimeSeconds:
      typeof data.runtime === "number" && data.runtime > 0 ? data.runtime * 60 : undefined,
  };
}

/** Build a CDN URL for a TMDB image path. */
export function imageUrl(path: string | null | undefined, size: string): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

export interface CatalogHit {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  year?: number;
  posterPath?: string;
}

export type TmdbAiringEpisode = {
  air_date: string | null;
  episode_number: number;
  season_number: number;
  name: string;
};

export interface TmdbTvDetails {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date?: string | null;
  last_episode_to_air?: TmdbAiringEpisode | null;
  next_episode_to_air: TmdbAiringEpisode | null;
  seasons: {
    air_date: string | null;
    season_number: number;
    name: string;
    episode_count?: number;
    poster_path?: string | null;
  }[];
}

export interface TmdbSeasonDetails {
  season_number: number;
  name: string;
  poster_path: string | null;
  episodes: {
    episode_number: number;
    name: string;
    air_date: string | null;
    still_path: string | null;
  }[];
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  poster_path: string | null;
  release_date?: string | null;
}

/** User-facing search: movies + shows in one round-trip, people dropped. */
export async function searchCatalog(query: string): Promise<CatalogHit[]> {
  const data = await get<{ results?: (SearchHit & { media_type?: string })[] }>("/search/multi", {
    query,
    include_adult: "false",
  });
  const hits: CatalogHit[] = [];
  for (const hit of data?.results ?? []) {
    const tmdbType = hit.media_type === "tv" || hit.media_type === "movie" ? hit.media_type : null;
    if (!tmdbType) continue;
    const title = (hit.name ?? hit.title ?? "").trim();
    if (!title) continue;
    hits.push({
      tmdbId: hit.id,
      tmdbType,
      title,
      year: yearOf(hit.first_air_date ?? hit.release_date),
      posterPath: hit.poster_path ?? undefined,
    });
    if (hits.length >= 20) break;
  }
  return hits;
}

export async function fetchTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
  return get<TmdbTvDetails>(`/tv/${tmdbId}`, {});
}

export async function fetchMovieDetails(tmdbId: number): Promise<TmdbMovieDetails | null> {
  return get<TmdbMovieDetails>(`/movie/${tmdbId}`, {});
}

export async function fetchSeason(tmdbId: number, season: number): Promise<TmdbSeasonDetails | null> {
  return get<TmdbSeasonDetails>(`/tv/${tmdbId}/season/${season}`, {});
}
