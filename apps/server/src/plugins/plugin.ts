import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client";
import type { LibraryService } from "../library/library.service";
import { ProviderAuthenticationError } from "../providers/errors";
import type { ProviderField } from "../providers/decorate";
import type { MediaType, ProviderSettings, ProviderStatus } from "../providers/provider";

export type PluginEvent = { type: "sync" } | { type: "watched"; keys: string[] };

export interface WatchMark {
  key: string;
  mediaType: MediaType;
  title?: string;
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  tmdbId?: number | null;
  year?: number | null;
}

export interface ExportResult {
  marked: Array<{ key: string; remoteId: string }>;
  unmatched: string[];
}

export interface PluginResult {
  exported?: number;
  unmatched?: number;
}

export interface PluginMeta {
  id: string;
  label: string;
  description?: string;
  auth: "credentials" | "none";
  fields: ProviderField[];
}

export type PluginLogFn = (
  level: "info" | "warn" | "error",
  message: string,
  data?: unknown
) => void | Promise<void>;

export interface PluginContext {
  db: Db;
  log?: PluginLogFn;
}

export interface PluginHttpContext {
  enabled: () => boolean;
  library: LibraryService;
}

export interface Plugin {
  applySettings?(settings: ProviderSettings): void;
  isAuthenticated?(): Promise<ProviderStatus>;
  login?(): Promise<void>;
  on?(event: PluginEvent, ctx: PluginContext): Promise<PluginResult | void>;
  mount?(app: FastifyInstance, ctx: PluginHttpContext): void;
}

export interface PluginRunResult {
  plugin: string;
  status: "success" | "error" | "skipped";
  exported?: number;
  unmatched?: number;
  durationMs: number;
  error?: string;
  errorType?: string;
  skipReason?: string;
}

interface RegistryEntry {
  ctor: new () => Plugin;
  meta: PluginMeta;
}

const registry: RegistryEntry[] = [];

/** Registers an integration that is not a VOD source. Hook points: `on` (events), `mount` (HTTP). */
export function Plugin(meta: PluginMeta): ClassDecorator {
  return (target) => {
    const ctor = target as unknown as new () => Plugin;
    if (!registry.some((entry) => entry.meta.id === meta.id)) {
      registry.push({ ctor, meta });
    }
  };
}

export function discoverPlugins(): Array<{ instance: Plugin; meta: PluginMeta }> {
  return registry.map(({ ctor, meta }) => ({ instance: new ctor(), meta }));
}

/** Test helper — do not use in production. */
export function resetPluginRegistry(): void {
  registry.length = 0;
}

export async function dispatchPluginEvent(
  entries: Array<{
    id: string;
    enabled: boolean;
    instance: Pick<Plugin, "on" | "applySettings">;
    settings: ProviderSettings;
  }>,
  event: PluginEvent,
  ctx: PluginContext,
  only?: string
): Promise<PluginRunResult[]> {
  const results: PluginRunResult[] = [];
  for (const entry of entries) {
    if (only && entry.id !== only) continue;
    if (!entry.instance.on) continue;
    if (!entry.enabled) continue;
    const started = Date.now();
    entry.instance.applySettings?.(entry.settings);
    try {
      const result = (await entry.instance.on(event, ctx)) ?? {};
      results.push({
        plugin: entry.id,
        status: "success",
        exported: result.exported,
        unmatched: result.unmatched,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.name : "Error";
      const durationMs = Date.now() - started;
      if (err instanceof ProviderAuthenticationError) {
        results.push({
          plugin: entry.id,
          status: "skipped",
          skipReason: "auth_required",
          error: message,
          errorType,
          durationMs,
        });
        continue;
      }
      results.push({
        plugin: entry.id,
        status: "error",
        error: message,
        errorType,
        durationMs,
      });
    }
  }
  return results;
}
