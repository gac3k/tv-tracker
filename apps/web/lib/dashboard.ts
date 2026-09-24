import type { LibraryCard } from "./api";

export function isInProgressCard(
  item: Pick<LibraryCard, "completed" | "progress" | "remainingSeconds" | "source" | "shelfHold">
): boolean {
  if (item.completed || item.shelfHold) return false;
  return (
    (item.progress != null && item.progress > 0) ||
    item.remainingSeconds != null ||
    item.source === "continue_watching"
  );
}

/** True when TMDB still has an aired episode after the one just finished. Unknown last-aired keeps the card. */
export function hasAvailableNext(item: LibraryCard): boolean {
  const lastSeason = item.lastAiredSeason;
  const lastEpisode = item.lastAiredEpisode;
  if (item.seasonNumber == null || item.episodeNumber == null || lastSeason == null || lastEpisode == null) {
    return true;
  }
  if (item.seasonNumber !== lastSeason) return item.seasonNumber < lastSeason;
  return item.episodeNumber < lastEpisode;
}

/** Mid-watch titles vs series whose latest episode is already finished. */
export function splitDashboard(items: LibraryCard[]): {
  continueWatching: LibraryCard[];
  watchNext: LibraryCard[];
} {
  const continueWatching: LibraryCard[] = [];
  const watchNext: LibraryCard[] = [];
  for (const item of items) {
    if (isInProgressCard(item)) continueWatching.push(item);
    else if (item.mediaType === "episode" && item.completed && hasAvailableNext(item)) {
      watchNext.push(asWatchNext(item));
    }
  }
  return { continueWatching, watchNext };
}

export function asWatchNext(item: LibraryCard): LibraryCard {
  return {
    ...item,
    episodeNumber: item.episodeNumber == null ? item.episodeNumber : item.episodeNumber + 1,
    title: item.showTitle ? null : item.title,
    completed: false,
    progress: null,
    remainingSeconds: null,
    progressSource: null,
  };
}

export function assertDashboardSplit(): void {
  const mid = {
    key: "a",
    mediaType: "episode",
    completed: false,
    progress: 40,
    remainingSeconds: null,
    source: "continue_watching",
    seasonNumber: 2,
    episodeNumber: 4,
    showTitle: "The Bear",
    title: "E4",
  } as LibraryCard;
  const done = { ...mid, key: "b", progress: 96, completed: true, source: "history" };
  const caughtUp = { ...done, key: "c", lastAiredSeason: 2, lastAiredEpisode: 4 };
  const moreAired = { ...done, key: "d", lastAiredSeason: 2, lastAiredEpisode: 8 };
  const rows = splitDashboard([mid, done]);
  if (rows.continueWatching.length !== 1) throw new Error("continue watching");
  if (rows.watchNext[0]?.episodeNumber !== 5) throw new Error("watch next +1");
  if (splitDashboard([caughtUp]).watchNext.length !== 0) throw new Error("caught up hidden");
  if (splitDashboard([moreAired]).watchNext[0]?.episodeNumber !== 5) throw new Error("unfinished kept");
  const held = { ...mid, key: "e", progress: 0, seasonNumber: 2, episodeNumber: 1, shelfHold: true };
  if (splitDashboard([held]).continueWatching.length !== 0) throw new Error("shelf hold hidden");
}

if (process.argv[1]?.includes("dashboard.ts")) {
  assertDashboardSplit();
  console.log("dashboard split ok");
}
