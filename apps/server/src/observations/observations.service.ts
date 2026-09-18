import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte } from "drizzle-orm";
import { actorUserId } from "../auth";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { providerObservations, syncState, type ObservationRow } from "../db/schema";
import type { PlaybackObservation, ProviderName } from "../providers/provider";

/**
 * Deterministic identity of an observation. Repeated polls returning identical
 * data map to the same fingerprint (no duplicates); a progress or remaining-time
 * change produces a new fingerprint (new meaningful observation).
 */
export function observationFingerprint(obs: PlaybackObservation): string {
  const key = JSON.stringify([
    obs.provider,
    obs.profileId ?? "",
    obs.providerContentId,
    obs.progress ?? null,
    obs.positionSeconds ?? null,
    obs.watchedAt?.getTime() ?? null,
    obs.source,
  ]);
  return createHash("sha256").update(key).digest("hex");
}

export interface InsertResult {
  inserted: number;
  skipped: number;
}

export interface ObservationQuery {
  provider?: ProviderName;
  since?: Date;
  limit?: number;
}

@Injectable()
export class ObservationsService {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(observations: PlaybackObservation[], parserVersion: string): InsertResult {
    let inserted = 0;
    for (const obs of observations) {
      const result = this.db
        .insert(providerObservations)
        .values({
          fingerprint: observationFingerprint(obs),
          userId: actorUserId(),
          provider: obs.provider,
          profileId: obs.profileId,
          providerContentId: obs.providerContentId,
          mediaType: obs.mediaType,
          title: obs.title,
          showTitle: obs.showTitle,
          seasonNumber: obs.seasonNumber,
          episodeNumber: obs.episodeNumber,
          progress: obs.progress,
          positionSeconds: obs.positionSeconds,
          durationSeconds: obs.durationSeconds,
          watchedAt: obs.watchedAt,
          observedAt: obs.observedAt,
          source: obs.source,
          raw: obs.raw,
          parserVersion,
        })
        .onConflictDoNothing({ target: providerObservations.fingerprint })
        .run();
      inserted += result.changes;
    }
    return { inserted, skipped: observations.length - inserted };
  }

  list(query: ObservationQuery = {}): ObservationRow[] {
    const conditions = [eq(providerObservations.userId, actorUserId())];
    if (query.provider) {
      conditions.push(eq(providerObservations.provider, query.provider));
    }
    if (query.since) {
      conditions.push(gte(providerObservations.observedAt, query.since));
    }
    return this.db
      .select()
      .from(providerObservations)
      .where(and(...conditions))
      .orderBy(desc(providerObservations.observedAt), desc(providerObservations.id))
      .limit(query.limit ?? 100)
      .all();
  }

  updateSyncState(
    provider: ProviderName,
    update: {
      status: "success" | "error" | "auth_required";
      error?: string;
      observationCount?: number;
    }
  ): void {
    const now = new Date();
    this.db
      .insert(syncState)
      .values({
        provider,
        lastSyncAt: now,
        lastSuccessAt: update.status === "success" ? now : null,
        lastSyncStatus: update.status,
        lastError: update.error ?? null,
        lastObservationCount: update.observationCount ?? null,
      })
      .onConflictDoUpdate({
        target: syncState.provider,
        set: {
          lastSyncAt: now,
          lastSyncStatus: update.status,
          lastError: update.error ?? null,
          lastObservationCount: update.observationCount ?? null,
          ...(update.status === "success" ? { lastSuccessAt: now } : {}),
        },
      })
      .run();
  }

  getSyncState(provider: ProviderName) {
    return this.db.select().from(syncState).where(eq(syncState.provider, provider)).get();
  }
}
