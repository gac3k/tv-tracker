import { groupByTitle, isInProgress, type LibraryItem } from "./aggregate";
import { androidLaunch, providerUrl, webosLaunch, type AndroidLaunch, type WebosLaunch } from "./deepLink";

export interface PlaybackLaunch {
  query: string;
  title: string;
  showTitle: string | null;
  provider: string;
  providerContentId: string;
  mediaType: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progress: number | null;
  completed: boolean;
  url: string | null;
  webos: WebosLaunch | null;
  android: AndroidLaunch | null;
}

/** Score a library title against a free-text query from Assist. */
export function matchScore(title: string, query: string): number {
  const needle = query.trim().toLowerCase();
  const hay = title.trim().toLowerCase();
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle) || needle.startsWith(hay)) return 80;
  if (hay.includes(needle)) return 60;
  if (needle.includes(hay) && hay.length >= 3) return 40;
  return 0;
}

/**
 * Pick the continue-watching (or last watched) item for a title query.
 * We only know ids already synced — "next episode" after a completed one is
 * that last episode, not an unseen catalog row.
 */
export function pickPlayback(items: LibraryItem[], query: string): LibraryItem | null {
  const needle = query.trim();
  if (!needle) return null;

  let best: { item: LibraryItem; score: number } | null = null;
  for (const group of groupByTitle(items)) {
    let score = matchScore(group.title, needle);
    if (score === 0) continue;
    if (isInProgress(group.latest)) score += 5;
    if (!best || score > best.score) best = { item: group.latest, score };
  }
  return best?.item ?? null;
}

export function toPlaybackLaunch(
  item: LibraryItem,
  query: string,
  extras?: { jellyfinServerUrl?: string }
): PlaybackLaunch {
  const url = providerUrl(item.provider, item.providerContentId, item.mediaType, extras);
  return {
    query,
    title: item.showTitle ?? item.title ?? item.providerContentId,
    showTitle: item.showTitle,
    provider: item.provider,
    providerContentId: item.providerContentId,
    mediaType: item.mediaType,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    progress: item.progress,
    completed: item.completed,
    url,
    webos: webosLaunch(item.provider, item.providerContentId, item.mediaType, extras),
    android: androidLaunch(item.provider, item.providerContentId, item.mediaType, extras),
  };
}
