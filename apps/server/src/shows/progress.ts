export type CatalogEpisode = {
  season: number;
  episode: number;
  airDate: string | null;
};

export type CatalogSeason = {
  season: number;
  episodes: CatalogEpisode[];
};

export type ProgressMark =
  | { mark: "caught_up"; today: string }
  | { mark: "season"; season: number; on: boolean }
  | { mark: "episode"; season: number; episode: number; on: boolean };

export function tmdbShowKey(tmdbId: number): string {
  return `tmdb:tv:${tmdbId}`;
}

export function tmdbSeasonKey(tmdbId: number, season: number): string {
  return `tmdb:tv:${tmdbId}:s${season}`;
}

export function tmdbEpisodeKey(tmdbId: number, season: number, episode: number): string {
  return `tmdb:tv:${tmdbId}:s${season}e${episode}`;
}

export function tmdbMovieKey(tmdbId: number): string {
  return `tmdb:movie:${tmdbId}`;
}

export type ParsedTmdbWatchKey =
  | { kind: "tv-show"; tmdbId: number }
  | { kind: "tv-season"; tmdbId: number; season: number }
  | { kind: "tv-episode"; tmdbId: number; season: number; episode: number }
  | { kind: "movie"; tmdbId: number };

export function parseTmdbWatchKey(key: string): ParsedTmdbWatchKey | null {
  const episode = /^tmdb:tv:(\d+):s(\d+)e(\d+)$/.exec(key);
  if (episode) {
    return {
      kind: "tv-episode",
      tmdbId: Number(episode[1]),
      season: Number(episode[2]),
      episode: Number(episode[3]),
    };
  }
  const season = /^tmdb:tv:(\d+):s(\d+)$/.exec(key);
  if (season) {
    return { kind: "tv-season", tmdbId: Number(season[1]), season: Number(season[2]) };
  }
  const show = /^tmdb:tv:(\d+)$/.exec(key);
  if (show) return { kind: "tv-show", tmdbId: Number(show[1]) };
  const movie = /^tmdb:movie:(\d+)$/.exec(key);
  if (movie) return { kind: "movie", tmdbId: Number(movie[1]) };
  return null;
}

export function isTvOverrideKey(key: string, tmdbId: number): boolean {
  const prefix = tmdbShowKey(tmdbId);
  return key === prefix || key.startsWith(`${prefix}:`);
}

export function isTmdbWatched(
  tmdbId: number | null | undefined,
  tmdbType: string | null | undefined,
  season: number | null,
  episode: number | null,
  overrides: { get(key: string): string | undefined }
): { completed: boolean; titleWatched: boolean } {
  if (!tmdbId) return { completed: false, titleWatched: false };
  if (tmdbType === "movie") {
    const watched = overrides.get(tmdbMovieKey(tmdbId)) === "watched";
    return { completed: watched, titleWatched: watched };
  }
  if (tmdbType !== "tv") return { completed: false, titleWatched: false };
  if (overrides.get(tmdbShowKey(tmdbId)) === "watched") {
    return { completed: true, titleWatched: true };
  }
  if (typeof season === "number" && overrides.get(tmdbSeasonKey(tmdbId, season)) === "watched") {
    return { completed: true, titleWatched: false };
  }
  if (
    typeof season === "number" &&
    typeof episode === "number" &&
    overrides.get(tmdbEpisodeKey(tmdbId, season, episode)) === "watched"
  ) {
    return { completed: true, titleWatched: false };
  }
  return { completed: false, titleWatched: false };
}

export function watchedFromOverrides(
  tmdbId: number,
  catalog: CatalogSeason[],
  overrides: { get(key: string): string | undefined }
): Set<string> {
  const set = new Set<string>();
  const showWatched = overrides.get(tmdbShowKey(tmdbId)) === "watched";
  for (const season of catalog) {
    const seasonWatched =
      showWatched || overrides.get(tmdbSeasonKey(tmdbId, season.season)) === "watched";
    for (const ep of season.episodes) {
      if (
        seasonWatched ||
        overrides.get(tmdbEpisodeKey(tmdbId, season.season, ep.episode)) === "watched"
      ) {
        set.add(`${season.season}:${ep.episode}`);
      }
    }
  }
  return set;
}

export function airedEpisodeIds(catalog: CatalogSeason[], today: string): string[] {
  const ids: string[] = [];
  for (const season of catalog) {
    if (season.season === 0) continue;
    for (const ep of season.episodes) {
      if (ep.airDate && ep.airDate <= today) ids.push(`${season.season}:${ep.episode}`);
    }
  }
  return ids;
}

export function applyProgressMark(
  catalog: CatalogSeason[],
  watched: Set<string>,
  mark: ProgressMark
): Set<string> {
  const next = new Set(watched);
  if (mark.mark === "caught_up") {
    for (const id of airedEpisodeIds(catalog, mark.today)) next.add(id);
    return next;
  }
  if (mark.mark === "season") {
    const season = catalog.find((row) => row.season === mark.season);
    if (!season) return next;
    for (const ep of season.episodes) {
      const id = `${mark.season}:${ep.episode}`;
      if (mark.on) next.add(id);
      else next.delete(id);
    }
    return next;
  }
  const id = `${mark.season}:${mark.episode}`;
  if (mark.on) next.add(id);
  else next.delete(id);
  return next;
}

export function compactWatchKeys(
  tmdbId: number,
  catalog: CatalogSeason[],
  watched: Set<string>
): string[] {
  const keys: string[] = [];
  for (const season of catalog) {
    if (season.episodes.length === 0) continue;
    const all = season.episodes.every((ep) => watched.has(`${season.season}:${ep.episode}`));
    if (all) {
      keys.push(tmdbSeasonKey(tmdbId, season.season));
      continue;
    }
    for (const ep of season.episodes) {
      if (watched.has(`${season.season}:${ep.episode}`)) {
        keys.push(tmdbEpisodeKey(tmdbId, season.season, ep.episode));
      }
    }
  }
  return keys;
}
