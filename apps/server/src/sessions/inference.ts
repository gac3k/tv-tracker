import type { NewSessionRow, ObservationRow } from "../db/schema";

export interface InferenceOptions {
  /** Max minutes between observations of the same content within one session. */
  gapMinutes: number;
  /** Progress percentage at or above which a session counts as completed. */
  watchedThresholdPercent: number;
}

/**
 * Heuristic session inference: group observations by (provider, profile,
 * content), order by time, split on large time gaps or a significant progress
 * drop (rewatch). This is derived data — never treat it as the provider's
 * authoritative history.
 */
export function inferSessions(
  observations: ObservationRow[],
  options: InferenceOptions
): NewSessionRow[] {
  const groups = new Map<string, ObservationRow[]>();
  for (const obs of observations) {
    const key = `${obs.provider} ${obs.profileId ?? ""} ${obs.providerContentId}`;
    const group = groups.get(key);
    if (group) {
      group.push(obs);
    } else {
      groups.set(key, [obs]);
    }
  }

  const gapMs = options.gapMinutes * 60_000;
  const sessions: NewSessionRow[] = [];
  const now = new Date();

  for (const group of groups.values()) {
    // Netflix history timestamps are day-precision, so observation time is the
    // more useful ordering signal for polling-based data.
    group.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

    let current: ObservationRow[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const progresses = current
        .map((o) => o.progress)
        .filter((p): p is number => typeof p === "number");
      const endProgress = progresses.length ? Math.max(...progresses) : null;
      sessions.push({
        provider: first.provider,
        profileId: first.profileId,
        providerContentId: first.providerContentId,
        mediaType: first.mediaType,
        title: last.title,
        showTitle: last.showTitle,
        seasonNumber: last.seasonNumber,
        episodeNumber: last.episodeNumber,
        startedAt: first.watchedAt ?? first.observedAt,
        endedAt: last.watchedAt ?? last.observedAt,
        startProgress: progresses.length ? progresses[0]! : null,
        endProgress,
        completed: endProgress !== null && endProgress >= options.watchedThresholdPercent,
        observationCount: current.length,
        updatedAt: now,
      });
      current = [];
    };

    for (const obs of group) {
      const prev = current[current.length - 1];
      if (prev) {
        const gap = obs.observedAt.getTime() - prev.observedAt.getTime();
        const progressDropped =
          typeof obs.progress === "number" &&
          typeof prev.progress === "number" &&
          obs.progress < prev.progress - 5; // small jitter tolerated, big drop = rewatch
        if (gap > gapMs || progressDropped) {
          flush();
        }
      }
      current.push(obs);
    }
    flush();
  }

  sessions.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
  return sessions;
}
