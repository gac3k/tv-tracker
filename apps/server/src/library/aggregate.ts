import type { ObservationRow } from "../db/schema";

/**
 * Providers whose `positionSeconds` means "time REMAINING", not elapsed.
 * Disney+ only exposes "NN min left" on Continue Watching. Apple TV progress
 * comes from `.progress-track` (played %), not minutes-left vs TMDB runtime.
 */
export const REMAINING_SECONDS_PROVIDERS = new Set(["disney"]);

export type ProgressSource = "provider" | "derived" | null;

export interface LibraryItem {
  key: string;
  provider: string;
  providerContentId: string;
  mediaType: string;
  title: string | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** 0-100, or null when neither the provider nor TMDB can tell us. */
  progress: number | null;
  progressSource: ProgressSource;
  /** Seconds left, when the provider reports remaining time. */
  remainingSeconds: number | null;
  completed: boolean;
  /** Latest observation's source; "continue_watching" means in-progress by definition. */
  source: string;
  watchedAt: Date | null;
  observedAt: Date;
  observationCount: number;
  /** User marked the whole title watched — drop it from Continue even if it's a series. */
  titleWatched?: boolean;
}

/**
 * Derive a progress percentage for providers that only report time remaining,
 * using a canonical runtime (TMDB). Returns null when either is missing.
 */
export function deriveProgress(
  remainingSeconds: number | null | undefined,
  runtimeSeconds: number | null | undefined
): number | null {
  if (
    typeof remainingSeconds !== "number" ||
    typeof runtimeSeconds !== "number" ||
    !Number.isFinite(remainingSeconds) ||
    !Number.isFinite(runtimeSeconds) ||
    runtimeSeconds <= 0
  ) {
    return null;
  }
  // More time remaining than the whole runtime means the two numbers describe
  // different things (wrong episode match, or a multi-episode block). Deriving
  // "0 %" from that would be worse than admitting we don't know.
  if (remainingSeconds > runtimeSeconds) {
    return null;
  }
  const elapsed = runtimeSeconds - remainingSeconds;
  const percent = (elapsed / runtimeSeconds) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/**
 * Collapse the observation log into one row per piece of content, keeping the
 * newest observation's metadata and the best progress value seen for it.
 */
export function aggregateObservations(
  observations: ObservationRow[],
  watchedThresholdPercent: number
): LibraryItem[] {
  const byContent = new Map<string, ObservationRow[]>();
  for (const obs of observations) {
    const key = `${obs.provider}:${obs.providerContentId}`;
    const group = byContent.get(key);
    if (group) {
      group.push(obs);
    } else {
      byContent.set(key, [obs]);
    }
  }

  const items: LibraryItem[] = [];
  for (const [key, group] of byContent) {
    group.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
    const latest = group[0]!;
    const isRemaining = REMAINING_SECONDS_PROVIDERS.has(latest.provider);

    // Highest reported progress wins — a rewatch shouldn't hide that the
    // episode was already finished once.
    const progresses = group
      .map((o) => o.progress)
      .filter((p): p is number => typeof p === "number");
    const progress = progresses.length ? Math.max(...progresses) : null;

    const remainingSeconds = isRemaining
      ? (group.find((o) => typeof o.positionSeconds === "number")?.positionSeconds ?? null)
      : null;

    items.push({
      key,
      provider: latest.provider,
      providerContentId: latest.providerContentId,
      mediaType: latest.mediaType,
      title: latest.title,
      showTitle: latest.showTitle,
      seasonNumber: latest.seasonNumber,
      episodeNumber: latest.episodeNumber,
      progress,
      progressSource: progress !== null ? "provider" : null,
      remainingSeconds,
      completed: progress !== null && progress >= watchedThresholdPercent,
      source: latest.source,
      watchedAt: latest.watchedAt,
      observedAt: latest.observedAt,
      observationCount: group.length,
    });
  }

  return applyAppleUpNextSemantics(items);
}

/** Apple Continue Watching is the *next* episode: E9 on the shelf means E8 is done. */
function applyAppleUpNextSemantics(items: LibraryItem[]): LibraryItem[] {
  const byShow = new Map<string, LibraryItem[]>();
  for (const item of items) {
    if (item.provider !== "apple" || item.mediaType !== "episode" || !item.showTitle) continue;
    const key = normalizeTitle(item.showTitle);
    const group = byShow.get(key);
    if (group) group.push(item);
    else byShow.set(key, [item]);
  }

  const done = new Set<string>();
  for (const group of byShow.values()) {
    const current = group
      .filter((item) => item.source === "continue_watching")
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
    if (!current) continue;
    const cap = episodePos(current.seasonNumber, current.episodeNumber);
    if (cap == null) continue;
    for (const item of group) {
      if (item.key === current.key) continue;
      const pos = episodePos(item.seasonNumber, item.episodeNumber);
      if (pos != null && pos < cap) done.add(item.key);
    }
  }
  if (done.size === 0) return items;
  return items.map((item) => (done.has(item.key) ? { ...item, completed: true } : item));
}

function episodePos(season: number | null, episode: number | null): number | null {
  if (typeof season !== "number" || typeof episode !== "number") return null;
  return season * 10_000 + episode;
}

/** Stable card key for title-level actions (`view=titles` and show-wide hide/watch). */
export function titleIdentityKey(item: LibraryItem): string {
  return `title:${normalizeTitle(displayTitle(item))}`;
}

export function contentIdentityKey(item: Pick<LibraryItem, "provider" | "providerContentId">): string {
  return `${item.provider}:${item.providerContentId}`;
}

/** True when this item is mid-watch, including Continue Watching shelves with no %. */
export function isInProgress(item: LibraryItem): boolean {
  if (item.completed) return false;
  return (
    (item.progress !== null && item.progress > 0) ||
    item.remainingSeconds !== null ||
    item.source === "continue_watching"
  );
}

/**
 * Title-level Continue: keep a series after you finish an episode (next one
 * is why the shelf exists). A finished movie drops off.
 */
export function isContinueTitle(item: LibraryItem): boolean {
  if (item.titleWatched) return false;
  if (isInProgress(item)) return true;
  return item.mediaType === "episode";
}

export interface TitleGroup<T extends LibraryItem = LibraryItem> {
  /** Normalized title used as the merge key. */
  key: string;
  title: string;
  lastWatched: Date;
  providers: string[];
  episodeCount: number;
  /** In-progress item if any, otherwise the most recently watched. */
  latest: T;
}

function displayTitle(item: LibraryItem): string {
  const raw =
    item.mediaType === "movie"
      ? item.title
      : (item.showTitle ?? item.title);
  return (raw ?? item.providerContentId).trim();
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Collapse episode/movie rows into one card per title, merging VODs.
 * Title-string merge only — spelling drift across providers will not join
 * until we have a canonical id (TMDB).
 */
export function groupByTitle<T extends LibraryItem>(items: T[]): TitleGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizeTitle(displayTitle(item));
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const out: TitleGroup<T>[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => {
      const at = (a.watchedAt ?? a.observedAt).getTime();
      const bt = (b.watchedAt ?? b.observedAt).getTime();
      return bt - at;
    });
    const last = group[0]!;
    const continueItem = group.find(isInProgress) ?? last;
    out.push({
      key,
      title: displayTitle(continueItem),
      lastWatched: last.watchedAt ?? last.observedAt,
      providers: [...new Set(group.map((item) => item.provider))],
      episodeCount: group.length,
      latest: continueItem,
    });
  }
  return out;
}

/** Fill in progress for remaining-time providers once a runtime is known. */
export function applyDerivedProgress(
  item: LibraryItem,
  runtimeSeconds: number | null,
  watchedThresholdPercent: number
): LibraryItem {
  if (item.progress !== null || item.remainingSeconds === null) {
    return item;
  }
  const derived = deriveProgress(item.remainingSeconds, runtimeSeconds);
  if (derived === null) {
    return item;
  }
  return {
    ...item,
    progress: derived,
    progressSource: "derived",
    completed: derived >= watchedThresholdPercent,
  };
}
