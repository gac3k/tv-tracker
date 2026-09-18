import { Inject, Injectable } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { ObservationsService } from "../observations/observations.service";
import { loadSettings, mergeProviderValues, saveSettings } from "../providers/registry.service";
import type { ProviderSettings } from "../providers/provider";
import {
  discoverPlugins,
  dispatchPluginEvent,
  type Plugin,
  type PluginEvent,
  type PluginLogFn,
  type PluginMeta,
  type PluginRunResult,
} from "./plugin";
import "./register";

const PLUGIN_DEFAULTS: ProviderSettings = { enabled: true, includeData: false, values: {} };

export interface PluginEntry {
  instance: Plugin;
  meta: PluginMeta;
  settings: ProviderSettings;
}

@Injectable()
export class PluginRegistry {
  private readonly discovered: Array<{ instance: Plugin; meta: PluginMeta }>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ObservationsService) private readonly observations: ObservationsService
  ) {
    this.discovered = discoverPlugins();
  }

  all(): PluginEntry[] {
    return this.discovered.map((entry) => ({
      ...entry,
      settings: this.readSettings(entry.meta.id),
    }));
  }

  has(id: string): boolean {
    return this.discovered.some((entry) => entry.meta.id === id);
  }

  get(id: string): PluginEntry {
    const entry = this.discovered.find((item) => item.meta.id === id);
    if (!entry) throw new Error(`Unknown plugin: ${id}`);
    return { ...entry, settings: this.readSettings(id) };
  }

  readSettings(id: string): ProviderSettings {
    return loadSettings(this.db, id, PLUGIN_DEFAULTS);
  }

  writeSettings(
    id: string,
    patch: { enabled?: boolean; includeData?: boolean; values?: Record<string, string> }
  ): ProviderSettings {
    this.get(id);
    const current = this.readSettings(id);
    const next: ProviderSettings = {
      enabled: patch.enabled ?? current.enabled,
      includeData: patch.includeData ?? current.includeData,
      values: mergeProviderValues(current.values, patch.values),
    };
    saveSettings(this.db, id, next);
    return next;
  }

  /** Register plugin HTTP routes. Call from the HTTP entrypoint, not the CLI. */
  mount(app: FastifyInstance): void {
    for (const entry of this.discovered) {
      entry.instance.mount?.(app, {
        enabled: () => this.readSettings(entry.meta.id).enabled,
      });
    }
  }

  async emit(event: PluginEvent, only?: string, log?: PluginLogFn): Promise<PluginRunResult[]> {
    const results = await dispatchPluginEvent(
      this.all().map((entry) => ({
        id: entry.meta.id,
        enabled: entry.settings.enabled,
        instance: entry.instance,
        settings: entry.settings,
      })),
      event,
      { db: this.db, log },
      only
    );
    for (const result of results) this.record(result);
    return results;
  }

  private record(result: PluginRunResult): void {
    if (result.status === "success") {
      this.observations.updateSyncState(result.plugin, {
        status: "success",
        observationCount: result.exported ?? 0,
      });
      return;
    }
    if (result.skipReason === "auth_required") {
      this.observations.updateSyncState(result.plugin, { status: "auth_required", error: result.error });
      return;
    }
    if (result.status === "error") {
      this.observations.updateSyncState(result.plugin, { status: "error", error: result.error });
    }
  }
}
