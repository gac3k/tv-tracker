export interface SearchNode {
  id: string;
  objectType?: string;
  content?: {
    title?: string;
    originalReleaseYear?: number;
    externalIds?: { tmdbId?: string | null };
  };
}

export interface EpisodeNode {
  id: string;
  content?: { episodeNumber?: number; seasonNumber?: number };
}

export interface SeasonNode {
  id: string;
  content?: { seasonNumber?: number };
  episodes?: EpisodeNode[];
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Pick a JustWatch node id. TMDB wins; otherwise a unique title (+ year) match. */
export function pickSearchMatch(
  nodes: SearchNode[],
  want: { title: string; tmdbId?: number | null; year?: number | null }
): string | null {
  if (want.tmdbId != null) {
    const tmdb = String(want.tmdbId);
    const hit = nodes.find((n) => n.content?.externalIds?.tmdbId === tmdb);
    if (hit) return hit.id;
  }
  const wanted = normalizeTitle(want.title);
  if (!wanted) return null;
  const exact = nodes.filter((n) => normalizeTitle(n.content?.title ?? "") === wanted);
  if (exact.length === 1) return exact[0]!.id;
  if (want.year != null) {
    const byYear = exact.filter((n) => n.content?.originalReleaseYear === want.year);
    if (byYear.length === 1) return byYear[0]!.id;
  }
  return null;
}

export function pickEpisodeId(
  seasons: SeasonNode[],
  seasonNumber: number,
  episodeNumber: number
): string | null {
  const season = seasons.find((s) => s.content?.seasonNumber === seasonNumber);
  const episode = season?.episodes?.find((e) => e.content?.episodeNumber === episodeNumber);
  return episode?.id ?? null;
}

function episodePos(seasonNumber: number, episodeNumber: number): number {
  return seasonNumber * 10_000 + episodeNumber;
}

/** Episode ids from the start of the show through SxEy. Season 0 (specials) only fills when the target is also specials. */
export function episodesThrough(
  seasons: SeasonNode[],
  seasonNumber: number,
  episodeNumber: number
): string[] {
  const cap = episodePos(seasonNumber, episodeNumber);
  const ids: string[] = [];
  for (const season of seasons) {
    const s = season.content?.seasonNumber;
    if (s == null) continue;
    if (s === 0 && seasonNumber !== 0) continue;
    for (const episode of season.episodes ?? []) {
      const e = episode.content?.episodeNumber;
      if (e == null || episodePos(s, e) > cap) continue;
      ids.push(episode.id);
    }
  }
  return ids;
}
