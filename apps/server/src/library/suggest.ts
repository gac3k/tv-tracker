import { isInProgress, type LibraryItem } from "./aggregate";

export type SuggestKind = "movie" | "series";
export type SuggestReason = "in_progress" | "watch_next" | "watchlist" | "unwatched";
export type ContinueSource = LibraryItem & {
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
  /** Shelf-only provider: keep this title off Continue Watching. */
  shelfHold?: boolean;
};

/** No account history — the shelf is the next episode, not a watch log. */
export const SHELF_PROVIDERS = new Set(["apple", "disney", "max"]);

const PILOT_NOISE_PERCENT = 2;

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

/**
 * Shelf-only providers (Apple TV, Disney+, Max) have no watch history.
 * Hold a title off Continue Watching when the shelf is offering an unwatched
 * pilot, or the next season's premiere before it has actually aired.
 * Unknown last-aired keeps a season gap on the shelf.
 */
export function isShelfHold(item: {
  provider: string;
  mediaType: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progress: number | null;
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
}): boolean {
  if (!SHELF_PROVIDERS.has(item.provider) || item.mediaType !== "episode") return false;
  const season = item.seasonNumber;
  const episode = item.episodeNumber;
  if (season == null || episode == null) return false;

  if (season === 1 && episode === 1 && item.progress != null && item.progress < PILOT_NOISE_PERCENT) {
    return true;
  }

  // Up Next after a season finale: S(n+1)E1 on the shelf before that episode airs.
  if (episode !== 1 || season <= 1) return false;
  if (item.progress != null && item.progress >= PILOT_NOISE_PERCENT) return false;
  const lastSeason = item.lastAiredSeason;
  const lastEpisode = item.lastAiredEpisode;
  if (lastSeason == null || lastEpisode == null) return false;
  const premiereAired = lastSeason > season || (lastSeason === season && lastEpisode >= episode);
  return !premiereAired;
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
    if (item.shelfHold) continue;
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
