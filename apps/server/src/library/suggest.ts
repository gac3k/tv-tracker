import { isInProgress, type LibraryItem } from "./aggregate";

export type SuggestKind = "movie" | "series";
export type SuggestReason = "in_progress" | "watch_next" | "watchlist" | "unwatched";
export type ContinueSource = LibraryItem & {
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
};

export interface SuggestItem {
  title: string;
  kind: SuggestKind;
  reason: SuggestReason;
  provider: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progress: number | null;
}

export interface WatchlistSuggestRow {
  title: string;
  tmdbType: "tv" | "movie";
}

function displayTitle(item: LibraryItem): string {
  return (item.showTitle ?? item.title ?? item.providerContentId).trim();
}

function kindOf(item: LibraryItem): SuggestKind {
  return item.mediaType === "movie" ? "movie" : "series";
}

function toItem(item: LibraryItem, reason: SuggestReason, episodeNumber = item.episodeNumber): SuggestItem {
  return {
    title: displayTitle(item),
    kind: kindOf(item),
    reason,
    provider: item.provider,
    seasonNumber: item.seasonNumber,
    episodeNumber,
    progress: reason === "in_progress" ? item.progress : null,
  };
}

/** True when TMDB still has an aired episode after the one just finished. Unknown last-aired keeps the title. */
export function hasAvailableNext(item: {
  seasonNumber: number | null;
  episodeNumber: number | null;
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
}): boolean {
  const lastSeason = item.lastAiredSeason;
  const lastEpisode = item.lastAiredEpisode;
  if (item.seasonNumber == null || item.episodeNumber == null || lastSeason == null || lastEpisode == null) {
    return true;
  }
  if (item.seasonNumber !== lastSeason) return item.seasonNumber < lastSeason;
  return item.episodeNumber < lastEpisode;
}

/**
 * In-progress titles first. Watch Next only when nothing is mid-watch.
 */
export function pickContinue(items: ContinueSource[], limit = 5): SuggestItem[] {
  const cap = Math.min(20, Math.max(1, limit));
  const continueWatching: SuggestItem[] = [];
  const watchNext: SuggestItem[] = [];
  for (const item of items) {
    if (isInProgress(item)) {
      continueWatching.push(toItem(item, "in_progress"));
    } else if (item.mediaType === "episode" && item.completed && hasAvailableNext(item)) {
      watchNext.push(
        toItem(item, "watch_next", item.episodeNumber == null ? item.episodeNumber : item.episodeNumber + 1)
      );
    }
  }
  return (continueWatching.length > 0 ? continueWatching : watchNext).slice(0, cap);
}

/** Watchlist first, then unwatched library titles. */
export function pickWatch(
  watchlist: WatchlistSuggestRow[],
  unwatched: LibraryItem[],
  kind?: SuggestKind,
  limit = 5
): SuggestItem[] {
  const cap = Math.min(20, Math.max(1, limit));
  const out: SuggestItem[] = [];
  const seen = new Set<string>();

  function add(item: SuggestItem): void {
    if (kind && item.kind !== kind) return;
    const key = item.title.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  }

  for (const row of watchlist) {
    if (out.length >= cap) return out;
    add({
      title: row.title.trim(),
      kind: row.tmdbType === "movie" ? "movie" : "series",
      reason: "watchlist",
      provider: null,
      seasonNumber: null,
      episodeNumber: null,
      progress: null,
    });
  }
  for (const item of unwatched) {
    if (out.length >= cap) return out;
    add(toItem(item, "unwatched"));
  }
  return out;
}
