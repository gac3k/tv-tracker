import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const SETTINGS_FILE = "app.settings.json";

export const TV_OS = ["webos", "android"] as const;
export type TvOs = (typeof TV_OS)[number];

export interface AppSettings {
  mcpEnabled: boolean;
  tvOs: TvOs;
}

const DEFAULTS: AppSettings = { mcpEnabled: true, tvOs: "webos" };

function settingsPath(dataDir = config.dataDir): string {
  return path.join(dataDir, SETTINGS_FILE);
}

function isTvOs(value: unknown): value is TvOs {
  return value === "webos" || value === "android";
}

export function readAppSettings(dataDir = config.dataDir): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(dataDir), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
    const rec = raw as Record<string, unknown>;
    return {
      mcpEnabled: typeof rec.mcpEnabled === "boolean" ? rec.mcpEnabled : DEFAULTS.mcpEnabled,
      tvOs: isTvOs(rec.tvOs) ? rec.tvOs : DEFAULTS.tvOs,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeAppSettings(
  patch: Partial<AppSettings>,
  dataDir = config.dataDir
): AppSettings {
  const next = { ...readAppSettings(dataDir), ...patch };
  fs.mkdirSync(dataDir, { recursive: true });
  const file = settingsPath(dataDir);
  fs.writeFileSync(file, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return next;
}
