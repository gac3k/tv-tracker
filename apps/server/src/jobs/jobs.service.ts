import { Inject, Injectable, Optional } from "@nestjs/common";
import { count, desc, eq, inArray } from "drizzle-orm";
import { config } from "../config";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { jobLogs, jobRuns, type JobLogRow, type JobRunRow } from "../db/schema";
import { PluginRegistry } from "../plugins/registry.service";
import type { PluginRunResult } from "../plugins/plugin";
import { BrowserProfileBusyError, ProviderAuthenticationError } from "../providers/errors";
import { ProviderRegistry } from "../providers/registry.service";
import type { ProviderName, SyncOptions } from "../providers/provider";
import { SyncService } from "../sync/sync.service";
import { redact } from "../utils/redact";
import { HomeAssistantMqtt } from "../hass/hass-mqtt";

export type JobTrigger = "schedule" | "manual" | "cli";
export type JobStatus = "queued" | "running" | "success" | "error" | "skipped";
export type JobLogLevel = "debug" | "info" | "warn" | "error";

export interface ProviderSyncSummary {
  provider: string;
  status: "success" | "error" | "skipped";
  fetched?: number;
  inserted?: number;
  skipped?: number;
  sessions?: number;
  exported?: number;
  unmatched?: number;
  durationMs?: number;
  error?: string;
  errorType?: string;
  skipReason?: string;
}

export interface JobRunDto {
  id: number;
  queueJobId: string | null;
  name: string;
  provider: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: unknown;
  error: string | null;
  errorType: string | null;
}

export interface JobLogDto {
  id: number;
  ts: string;
  level: string;
  message: string;
  data: unknown;
}

export interface JobTarget {
  id: string;
  label: string;
  kind: "source" | "plugin";
}

const KEEP_RUNS = 200;

@Injectable()
export class JobsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Optional() @Inject(HomeAssistantMqtt) private readonly hass?: HomeAssistantMqtt
  ) {}

  begin(input: {
    name?: string;
    trigger: JobTrigger;
    provider?: string | null;
    queueJobId?: string | null;
    status?: JobStatus;
  }): JobRunRow {
    const row = this.db
      .insert(jobRuns)
      .values({
        name: input.name ?? "sync",
        trigger: input.trigger,
        provider: input.provider ?? null,
        queueJobId: input.queueJobId ?? null,
        status: input.status ?? "running",
        startedAt: new Date(),
      })
      .returning()
      .get();
    this.prune();
    return row!;
  }

  setQueueJobId(runId: number, queueJobId: string): void {
    this.db.update(jobRuns).set({ queueJobId }).where(eq(jobRuns.id, runId)).run();
  }

  append(runId: number, level: JobLogLevel, message: string, data?: unknown): void {
    this.db
      .insert(jobLogs)
      .values({
        runId,
        ts: new Date(),
        level,
        message,
        data: data === undefined ? null : redact(data),
      })
      .run();
  }

  finish(
    runId: number,
    update: {
      status: JobStatus;
      summary?: unknown;
      error?: string | null;
      errorType?: string | null;
    }
  ): void {
    const row = this.db.select().from(jobRuns).where(eq(jobRuns.id, runId)).get();
    const finishedAt = new Date();
    const durationMs = row ? finishedAt.getTime() - row.startedAt.getTime() : null;
    this.db
      .update(jobRuns)
      .set({
        status: update.status,
        finishedAt,
        durationMs,
        summary: update.summary ?? row?.summary ?? null,
        error: update.error ?? null,
        errorType: update.errorType ?? null,
      })
      .where(eq(jobRuns.id, runId))
      .run();
  }

  targets(): JobTarget[] {
    const sources = this.registry.all().map((entry) => ({
      id: entry.meta.id,
      label: entry.meta.label,
      kind: "source" as const,
    }));
    const plugins = this.plugins
      .all()
      .filter((entry) => entry.instance.on)
      .map((entry) => ({
        id: entry.meta.id,
        label: entry.meta.label,
        kind: "plugin" as const,
      }));
    return [...sources, ...plugins];
  }

  list(limit = 50): JobRunDto[] {
    return this.db
      .select()
      .from(jobRuns)
      .orderBy(desc(jobRuns.id))
      .limit(limit)
      .all()
      .map(toRunDto);
  }

  get(id: number): (JobRunDto & { logs: JobLogDto[] }) | null {
    const row = this.db.select().from(jobRuns).where(eq(jobRuns.id, id)).get();
    if (!row) return null;
    const logs = this.db
      .select()
      .from(jobLogs)
      .where(eq(jobLogs.runId, id))
      .orderBy(jobLogs.id)
      .all()
      .map(toLogDto);
    return { ...toRunDto(row), logs };
  }

  /**
   * Run the sync pipeline and persist a debug log. Used by the BullMQ worker and the CLI.
   * Per-provider failures are recorded; a single-provider call rethrows so HTTP can map status codes.
   */
  async execute(opts: {
    trigger: JobTrigger;
    provider?: string;
    runId?: number;
    queueJobId?: string;
    options?: SyncOptions;
    jobLog?: (line: string) => Promise<unknown>;
  }): Promise<{ runId: number; results: ProviderSyncSummary[] }> {
    const run =
      opts.runId != null
        ? this.db.select().from(jobRuns).where(eq(jobRuns.id, opts.runId)).get()
        : this.begin({
            trigger: opts.trigger,
            provider: opts.provider ?? null,
            queueJobId: opts.queueJobId ?? null,
            status: "running",
          });
    if (!run) throw new Error(`Unknown job run: ${opts.runId}`);
    if (opts.queueJobId && !run.queueJobId) this.setQueueJobId(run.id, opts.queueJobId);
    this.db.update(jobRuns).set({ status: "running" }).where(eq(jobRuns.id, run.id)).run();

    const log = async (level: JobLogLevel, message: string, data?: unknown) => {
      this.append(run.id, level, message, data);
      const payload = data === undefined ? "" : ` ${JSON.stringify(redact(data))}`;
      await opts.jobLog?.(`${level} ${message}${payload}`);
    };

    await log("info", "job started", {
      trigger: opts.trigger,
      provider: opts.provider ?? null,
      intervalMinutes: config.SYNC_INTERVAL_MINUTES,
      pages: opts.options?.pages ?? config.SYNC_PAGES,
      saveFixture: opts.options?.saveFixture ?? false,
      pid: process.pid,
    });

    const pluginOnly = opts.provider != null && this.plugins.has(opts.provider);
    const sources = pluginOnly
      ? []
      : planSyncTargets(
          opts.provider,
          this.registry.all().map((entry) => ({ id: entry.meta.id, enabled: entry.settings.enabled }))
        );
    const emitPlugins = pluginOnly || !opts.provider || this.registry.has(opts.provider);

    if (sources.length === 0 && !emitPlugins) {
      await log("warn", "no enabled providers to sync");
      this.finish(run.id, { status: "skipped", summary: { results: [] } });
      return { runId: run.id, results: [] };
    }

    await log("info", "sync targets", {
      sources,
      plugins: emitPlugins ? (pluginOnly ? [opts.provider] : this.plugins.all().filter((p) => p.settings.enabled).map((p) => p.meta.id)) : [],
    });

    const results: ProviderSyncSummary[] = [];
    for (const name of sources) {
      results.push(await this.syncOne(name, opts.options ?? {}, log));
    }
    if (emitPlugins) {
      const pluginResults = await this.plugins.emit(
        { type: "sync" },
        pluginOnly ? opts.provider : undefined,
        (level, message, data) => log(level, message, data)
      );
      for (const result of pluginResults) {
        await log(result.status === "error" ? "error" : "info", "plugin done", result);
        results.push(toPluginSummary(result));
      }
    }

    const failed = results.filter((r) => r.status === "error");
    const skipped = results.filter((r) => r.status === "skipped");
    const status: JobStatus = failed.length
      ? "error"
      : results.length > 0 && skipped.length === results.length
        ? "skipped"
        : "success";
    const problem = failed[0] ?? (status === "skipped" ? skipped[0] : undefined);
    const durationMs = Date.now() - run.startedAt.getTime();
    await log(status === "error" ? "error" : "info", "job finished", {
      status,
      durationMs,
      results,
    });
    this.finish(run.id, {
      status,
      summary: { results },
      error: problem?.error ?? null,
      errorType: problem?.errorType ?? null,
    });
    this.hass?.publish();
    return { runId: run.id, results };
  }

  private async syncOne(
    providerName: ProviderName,
    options: SyncOptions,
    log: (level: JobLogLevel, message: string, data?: unknown) => Promise<void>
  ): Promise<ProviderSyncSummary> {
    const started = Date.now();
    let entry;
    try {
      entry = this.registry.get(providerName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await log("error", "unknown provider", { provider: providerName, error: message });
      return { provider: providerName, status: "error", error: message, errorType: "Error", durationMs: 0 };
    }

    const fieldKeys = Object.keys(entry.settings.values).filter((key) => entry.settings.values[key]);
    await log("info", "provider begin", {
      provider: providerName,
      enabled: entry.settings.enabled,
      includeData: entry.settings.includeData,
      auth: entry.meta.auth,
      parserVersion: entry.meta.parserVersion,
      configuredFields: fieldKeys,
    });

    try {
      const result = await this.sync.runSync(providerName, options, (message, data) =>
        log("info", message, { provider: providerName, ...data })
      );
      const summary: ProviderSyncSummary = {
        provider: providerName,
        status: "success",
        ...result,
        durationMs: Date.now() - started,
      };
      await log("info", "provider done", summary);
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.name : "Error";
      const durationMs = Date.now() - started;
      if (err instanceof ProviderAuthenticationError) {
        await log("warn", "provider skipped (not authenticated)", { provider: providerName, durationMs });
        return { provider: providerName, status: "skipped", skipReason: "auth_required", error: message, errorType, durationMs };
      }
      if (err instanceof BrowserProfileBusyError) {
        await log("warn", "provider skipped (browser profile busy)", { provider: providerName, durationMs });
        return { provider: providerName, status: "skipped", skipReason: "profile_busy", error: message, errorType, durationMs };
      }
      await log("error", "provider failed", {
        provider: providerName,
        error: message,
        errorType,
        stack: err instanceof Error ? err.stack : undefined,
        durationMs,
      });
      return { provider: providerName, status: "error", error: message, errorType, durationMs };
    }
  }

  private prune(keep = KEEP_RUNS): void {
    const total = this.db.select({ n: count() }).from(jobRuns).get()?.n ?? 0;
    const extraCount = total - keep;
    if (extraCount <= 0) return;
    const extra = this.db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .orderBy(jobRuns.id)
      .limit(extraCount)
      .all();
    if (extra.length === 0) return;
    const ids = extra.map((row) => row.id);
    this.db.delete(jobLogs).where(inArray(jobLogs.runId, ids)).run();
    this.db.delete(jobRuns).where(inArray(jobRuns.id, ids)).run();
  }
}

function toRunDto(row: JobRunRow): JobRunDto {
  return {
    id: row.id,
    queueJobId: row.queueJobId,
    name: row.name,
    provider: row.provider,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    summary: row.summary,
    error: row.error,
    errorType: row.errorType,
  };
}

function toLogDto(row: JobLogRow): JobLogDto {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    level: row.level,
    message: row.message,
    data: row.data,
  };
}

function toPluginSummary(result: PluginRunResult): ProviderSyncSummary {
  return {
    provider: result.plugin,
    status: result.status,
    exported: result.exported,
    unmatched: result.unmatched,
    durationMs: result.durationMs,
    error: result.error,
    errorType: result.errorType,
    skipReason: result.skipReason,
  };
}

export function planSyncTargets(
  requested: string | undefined,
  entries: Array<{ id: string; enabled: boolean }>
): string[] {
  if (requested) return [requested];
  return entries.filter((item) => item.enabled).map((item) => item.id);
}
