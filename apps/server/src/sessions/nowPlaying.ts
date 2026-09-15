import { desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { providerObservations } from "../db/schema";

export interface NowPlayingResult {
  active: boolean;
  provider?: string;
  content?: {
    title: string | null;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
  };
  progress?: number | null;
  confidence?: number;
  lastObservedAt?: string;
}

/**
 * Heuristic "possibly watching right now" guess based on recent observations.
 * This is NOT real-time playback state — Netflix history lags actual playback.
 */
export function getNowPlaying(
  db: Db,
  options: { windowMinutes: number; watchedThresholdPercent: number }
): NowPlayingResult {
  const recent = db
    .select()
    .from(providerObservations)
    .orderBy(desc(providerObservations.observedAt), desc(providerObservations.id))
    .limit(200)
    .all();
  if (recent.length === 0) {
    return { active: false };
  }

  const now = Date.now();
  const windowMs = options.windowMinutes * 60_000;

  for (const obs of recent) {
    const age = now - obs.observedAt.getTime();
    if (age > windowMs) {
      break; // rows are ordered newest-first
    }
    if (typeof obs.progress !== "number") {
      continue;
    }
    // Fully watched content is not "now playing".
    if (obs.progress >= options.watchedThresholdPercent) {
      continue;
    }
    // Did progress increase compared to an earlier observation of this content?
    const previous = recent.find(
      (o) =>
        o.id !== obs.id &&
        o.provider === obs.provider &&
        o.providerContentId === obs.providerContentId &&
        o.observedAt.getTime() <= obs.observedAt.getTime() &&
        typeof o.progress === "number"
    );
    const progressIncreased =
      previous && typeof previous.progress === "number" && obs.progress > previous.progress;
    if (!progressIncreased) {
      continue;
    }
    // Confidence decays with observation age within the window.
    const confidence = Math.round((0.5 + 0.5 * (1 - age / windowMs)) * 100) / 100;
    return {
      active: true,
      provider: obs.provider,
      content: {
        title: obs.title,
        showTitle: obs.showTitle,
        seasonNumber: obs.seasonNumber,
        episodeNumber: obs.episodeNumber,
      },
      progress: obs.progress,
      confidence,
      lastObservedAt: obs.observedAt.toISOString(),
    };
  }
  return { active: false };
}
