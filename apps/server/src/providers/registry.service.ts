import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { providerSettings } from "../db/schema";
import { discoverContentProviders, type ContentProviderMeta } from "./decorate";
import "./register";
import type { ProviderSettings, VodProvider } from "./provider";

export interface ProviderEntry {
  instance: VodProvider;
  meta: ContentProviderMeta;
  settings: ProviderSettings;
}

@Injectable()
export class ProviderRegistry {
  private readonly discovered: Array<{ instance: VodProvider; meta: ContentProviderMeta }>;

  constructor(@Inject(DB) private readonly db: Db) {
    this.discovered = discoverContentProviders();
  }

  all(): ProviderEntry[] {
    return this.discovered.map((entry) => ({
      ...entry,
      settings: this.readSettings(entry.meta.id),
    }));
  }

  has(name: string): boolean {
    return this.discovered.some((item) => item.meta.id === name);
  }

  get(name: string): ProviderEntry {
    const entry = this.discovered.find((item) => item.meta.id === name);
    if (!entry) {
      throw new Error(`Unknown or not yet implemented provider: ${name}`);
    }
    return { ...entry, settings: this.readSettings(name) };
  }

  hiddenProviders(): Set<string> {
    return new Set(
      this.all()
        .filter((entry) => !entry.settings.includeData)
        .map((entry) => entry.meta.id)
    );
  }

  readSettings(id: string): ProviderSettings {
    return loadSettings(this.db, id, { enabled: true, includeData: true, values: {} });
  }

  writeSettings(
    id: string,
    patch: { enabled?: boolean; includeData?: boolean; values?: Record<string, string> }
  ): ProviderSettings {
    this.get(id); // throw if unknown
    const current = this.readSettings(id);
    const next: ProviderSettings = {
      enabled: patch.enabled ?? current.enabled,
      includeData: patch.includeData ?? current.includeData,
      values: mergeProviderValues(current.values, patch.values),
    };
    saveSettings(this.db, id, next);
    return next;
  }
}

export function loadSettings(db: Db, id: string, defaults: ProviderSettings): ProviderSettings {
  const row = db.select().from(providerSettings).where(eq(providerSettings.provider, id)).get();
  if (!row) return defaults;
  const raw = row.config;
  const values =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string"
          )
        )
      : {};
  return { enabled: row.enabled, includeData: row.includeData, values };
}

export function saveSettings(db: Db, id: string, next: ProviderSettings): void {
  const now = new Date();
  db.insert(providerSettings)
    .values({
      provider: id,
      enabled: next.enabled,
      includeData: next.includeData,
      config: next.values,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerSettings.provider,
      set: {
        enabled: next.enabled,
        includeData: next.includeData,
        config: next.values,
        updatedAt: now,
      },
    })
    .run();
}

function sanitizeValues(values: Record<string, string> | undefined): Record<string, string> {
  if (!values) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") continue; // blank secret field = keep existing
    out[key] = trimmed;
  }
  return out;
}

export function mergeProviderValues(
  current: Record<string, string>,
  patch: Record<string, string> | undefined
): Record<string, string> {
  return { ...current, ...sanitizeValues(patch) };
}

export function redactValues(
  fields: ContentProviderMeta["fields"],
  values: Record<string, string>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of fields) {
    const current = values[field.key];
    if (!current) {
      out[field.key] = "";
    } else if (field.type === "secret") {
      out[field.key] = null; // set, but never echoed
    } else {
      out[field.key] = current;
    }
  }
  return out;
}
