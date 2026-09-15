import { Inject, Injectable } from "@nestjs/common";
import { desc } from "drizzle-orm";
import { config } from "../config";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { playbackSessions, providerObservations, type SessionRow } from "../db/schema";
import { inferSessions } from "./inference";
import { getNowPlaying, type NowPlayingResult } from "./nowPlaying";

@Injectable()
export class SessionsService {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Rebuild the derived playback_sessions table from all observations.
   * Full rebuild is O(total observations) on every sync; switch to incremental
   * per-content rebuild if the table ever grows past ~100k rows.
   */
  rebuild(): number {
    const observations = this.db
      .select()
      .from(providerObservations)
      .orderBy(desc(providerObservations.observedAt))
      .all();
    const sessions = inferSessions(observations, {
      gapMinutes: config.SESSION_GAP_MINUTES,
      watchedThresholdPercent: config.WATCHED_THRESHOLD_PERCENT,
    });
    this.db.transaction((tx) => {
      tx.delete(playbackSessions).run();
      if (sessions.length) {
        tx.insert(playbackSessions).values(sessions).run();
      }
    });
    return sessions.length;
  }

  list(query: { provider?: string; since?: Date; limit: number }): SessionRow[] {
    let rows = this.db
      .select()
      .from(playbackSessions)
      .orderBy(desc(playbackSessions.endedAt))
      .limit(500)
      .all();
    if (query.provider) {
      rows = rows.filter((r) => r.provider === query.provider);
    }
    if (query.since) {
      rows = rows.filter((r) => r.endedAt >= query.since!);
    }
    return rows.slice(0, query.limit);
  }

  nowPlaying(): NowPlayingResult {
    return getNowPlaying(this.db, {
      windowMinutes: config.NOW_PLAYING_WINDOW_MINUTES,
      watchedThresholdPercent: config.WATCHED_THRESHOLD_PERCENT,
    });
  }
}
