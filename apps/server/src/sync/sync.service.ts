import { Inject, Injectable } from "@nestjs/common";
import { logger } from "../logger";
import { ObservationsService, type InsertResult } from "../observations/observations.service";
import { ProviderAuthenticationError, ProviderError } from "../providers/errors";
import { ProviderRegistry } from "../providers/registry.service";
import type { PlaybackObservation, ProviderName, SyncOptions, VodProvider } from "../providers/provider";
import { SessionsService } from "../sessions/sessions.service";
import { config } from "../config";

export interface SyncRunResult extends InsertResult {
  fetched: number;
  sessions: number;
}

export type SyncLogFn = (message: string, data?: Record<string, unknown>) => void | Promise<void>;

@Injectable()
export class SyncService {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(ObservationsService) private readonly observations: ObservationsService,
    @Inject(SessionsService) private readonly sessions: SessionsService
  ) {}

  get providers(): Record<string, VodProvider> {
    return Object.fromEntries(this.registry.all().map((entry) => [entry.meta.id, entry.instance]));
  }

  getProvider(name: string): VodProvider {
    const entry = this.registry.get(name);
    entry.instance.applySettings?.(entry.settings);
    return entry.instance;
  }

  /** Full sync pipeline: fetch, persist, rebuild derived sessions, record state. */
  async runSync(
    providerName: ProviderName,
    options: SyncOptions = {},
    log: SyncLogFn = () => undefined
  ): Promise<SyncRunResult> {
    const entry = this.registry.get(providerName);
    entry.instance.applySettings?.(entry.settings);
    try {
      await log("fetching observations", {
        pages: options.pages ?? config.SYNC_PAGES,
        saveFixture: options.saveFixture ?? false,
      });
      const fetchStarted = Date.now();
      const fetched = await entry.instance.sync(options);
      await log("fetched observations", {
        count: fetched.length,
        durationMs: Date.now() - fetchStarted,
        byType: countBy(fetched, "mediaType"),
        bySource: countBy(fetched, "source"),
        sample: sampleObservations(fetched),
      });
      const persistStarted = Date.now();
      const result = this.observations.insert(fetched, entry.meta.parserVersion);
      await log("persisted observations", { ...result, durationMs: Date.now() - persistStarted });
      const sessionStarted = Date.now();
      const sessions = this.sessions.rebuild();
      await log("rebuilt sessions", { sessions, durationMs: Date.now() - sessionStarted });
      this.observations.updateSyncState(providerName, {
        status: "success",
        observationCount: fetched.length,
      });
      return { ...result, fetched: fetched.length, sessions };
    } catch (err) {
      const status = err instanceof ProviderAuthenticationError ? "auth_required" : "error";
      const message = err instanceof Error ? err.message : String(err);
      this.observations.updateSyncState(providerName, { status, error: message });
      if (err instanceof ProviderError) {
        logger.error(
          { provider: providerName, errorType: err.name, err: message },
          "sync failed"
        );
      }
      throw err;
    }
  }

  recordState(
    providerName: ProviderName,
    update: { status: "success" | "error" | "auth_required"; error?: string; observationCount?: number }
  ): void {
    this.observations.updateSyncState(providerName, update);
  }
}

export function sampleObservations(fetched: PlaybackObservation[], n = 15) {
  return fetched.slice(0, n).map((obs) => ({
    id: obs.providerContentId,
    type: obs.mediaType,
    title: obs.showTitle ? `${obs.showTitle} · ${obs.title ?? ""}`.trim() : (obs.title ?? null),
    season: obs.seasonNumber ?? null,
    episode: obs.episodeNumber ?? null,
    progress: obs.progress ?? null,
    source: obs.source,
    watchedAt: obs.watchedAt?.toISOString() ?? null,
  }));
}

export function countBy(items: PlaybackObservation[], key: "mediaType" | "source"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}
