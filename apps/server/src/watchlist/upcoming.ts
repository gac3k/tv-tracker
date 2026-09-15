import type { TmdbMovieDetails, TmdbTvDetails } from "../artwork/tmdb";

export type UpcomingKind = "movie" | "series" | "season";

export interface UpcomingPick {
  kind: UpcomingKind;
  airDate: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  subtitle: string;
}

export function todayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type LastAiredEpisode = { season: number; episode: number };

function episodePos(season: number, episode: number): number {
  return season * 10_000 + episode;
}

/** Latest episode that has already aired — last_episode_to_air, or next if its air date is today-or-past. */
export function lastAvailableEpisode(tv: TmdbTvDetails, today: string): LastAiredEpisode | null {
  const last = tv.last_episode_to_air;
  let pick: LastAiredEpisode | null = last
    ? { season: last.season_number, episode: last.episode_number }
    : null;
  const next = tv.next_episode_to_air;
  if (next?.air_date && next.air_date <= today) {
    const candidate = { season: next.season_number, episode: next.episode_number };
    if (!pick || episodePos(candidate.season, candidate.episode) > episodePos(pick.season, pick.episode)) {
      pick = candidate;
    }
  }
  return pick;
}

function futureDate(value: string | null | undefined, today: string): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today;
}

/** Show page and upcoming share `tv:{id}` in tmdb_details with different shapes. */
export function unwrapTvDetails(value: unknown): TmdbTvDetails | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.tv && typeof obj.tv === "object") return unwrapTvDetails(obj.tv);
  if (Array.isArray(obj.seasons) && typeof obj.name === "string") return value as TmdbTvDetails;
  return null;
}

/** Season premiere (E1) or a future season air date — skip mid-season episodes. */
export function pickUpcomingTv(tv: TmdbTvDetails, today: string): UpcomingPick | null {
  const next = tv.next_episode_to_air;
  if (futureDate(next?.air_date, today) && next && next.episode_number === 1) {
    const kind: UpcomingKind = next.season_number <= 1 ? "series" : "season";
    return {
      kind,
      airDate: next.air_date,
      seasonNumber: next.season_number,
      episodeNumber: 1,
      subtitle: kind === "series" ? "Series premiere" : `Season ${next.season_number}`,
    };
  }

  const seasons = [...(tv.seasons ?? [])]
    .filter((season) => season.season_number > 0 && futureDate(season.air_date, today))
    .sort((a, b) => a.air_date!.localeCompare(b.air_date!));
  const season = seasons[0];
  if (!season?.air_date) return null;
  const kind: UpcomingKind = season.season_number <= 1 ? "series" : "season";
  return {
    kind,
    airDate: season.air_date,
    seasonNumber: season.season_number,
    episodeNumber: 1,
    subtitle: kind === "series" ? "Series premiere" : `Season ${season.season_number}`,
  };
}

export function pickUpcomingMovie(movie: TmdbMovieDetails, today: string): UpcomingPick | null {
  if (!futureDate(movie.release_date, today)) return null;
  return {
    kind: "movie",
    airDate: movie.release_date,
    seasonNumber: null,
    episodeNumber: null,
    subtitle: "Movie premiere",
  };
}
