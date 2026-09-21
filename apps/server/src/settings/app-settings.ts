import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { config } from "../config";

export const CONFIG_FILE = "config.yaml";
export const TV_OS = ["webos", "android"] as const;
export type TvOs = (typeof TV_OS)[number];

export interface AppSettings {
  mcpEnabled: boolean;
  tvOs: TvOs;
  tmdbApiKey: string | undefined;
  mqttUrl: string | undefined;
  discoveryPrefix: string;
}

export type EnvLock = "mcpEnabled" | "tvOs" | "tmdbApiKey" | "mqttUrl";

const DEFAULTS: AppSettings = {
  mcpEnabled: true,
  tvOs: "webos",
  tmdbApiKey: undefined,
  mqttUrl: undefined,
  discoveryPrefix: "homeassistant",
};

export const DEFAULT_YAML = `# vod-tracker settings. Environment variables override matching keys:
#   MCP_ENABLED, TV_OS, TMDB_API_KEY, MQTT_URL
mcp:
  enabled: true
tv:
  os: webos
tmdb:
  api_key: ""
homeassistant:
  mqtt_url: ""
`;

export function configPath(dataDir = config.dataDir): string {
  return path.join(dataDir, CONFIG_FILE);
}

function isTvOs(value: unknown): value is TvOs {
  return value === "webos" || value === "android";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return undefined;
}

function envLocks(): EnvLock[] {
  const locks: EnvLock[] = [];
  if (envBool("MCP_ENABLED") !== undefined) locks.push("mcpEnabled");
  if (isTvOs(process.env.TV_OS?.trim())) locks.push("tvOs");
  if (process.env.TMDB_API_KEY?.trim()) locks.push("tmdbApiKey");
  if (process.env.MQTT_URL?.trim()) locks.push("mqttUrl");
  return locks;
}

function fromFileShape(raw: unknown): AppSettings {
  const root = asRecord(raw);
  const mcp = asRecord(root.mcp);
  const tv = asRecord(root.tv);
  const tmdb = asRecord(root.tmdb);
  const ha = asRecord(root.homeassistant);
  return {
    mcpEnabled: typeof mcp.enabled === "boolean" ? mcp.enabled : DEFAULTS.mcpEnabled,
    tvOs: isTvOs(tv.os) ? tv.os : DEFAULTS.tvOs,
    tmdbApiKey: str(tmdb.api_key),
    mqttUrl: str(ha.mqtt_url),
    discoveryPrefix: str(ha.discovery_prefix) ?? DEFAULTS.discoveryPrefix,
  };
}

function overlayEnv(file: AppSettings): AppSettings {
  return {
    mcpEnabled: envBool("MCP_ENABLED") ?? file.mcpEnabled,
    tvOs: isTvOs(process.env.TV_OS?.trim()) ? process.env.TV_OS!.trim() as TvOs : file.tvOs,
    tmdbApiKey: process.env.TMDB_API_KEY?.trim() || file.tmdbApiKey,
    mqttUrl: process.env.MQTT_URL?.trim() || file.mqttUrl,
    discoveryPrefix: file.discoveryPrefix,
  };
}

function migrateLegacy(dataDir: string): string | null {
  if (fs.existsSync(configPath(dataDir))) return null;
  let mcpEnabled = DEFAULTS.mcpEnabled;
  let tvOs: TvOs = DEFAULTS.tvOs;
  let tmdbApiKey: string | undefined;
  let found = false;
  try {
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, "app.settings.json"), "utf8")) as unknown;
    const rec = asRecord(json);
    if (typeof rec.mcpEnabled === "boolean") {
      mcpEnabled = rec.mcpEnabled;
      found = true;
    }
    if (isTvOs(rec.tvOs)) {
      tvOs = rec.tvOs;
      found = true;
    }
  } catch {
    // no legacy json
  }
  try {
    const key = fs.readFileSync(path.join(dataDir, "tmdb.api_key"), "utf8").trim();
    if (key) {
      tmdbApiKey = key;
      found = true;
    }
  } catch {
    // no legacy key file
  }
  if (!found) return null;
  return stringify(
    {
      mcp: { enabled: mcpEnabled },
      tv: { os: tvOs },
      tmdb: { api_key: tmdbApiKey ?? "" },
      homeassistant: { mqtt_url: "" },
    },
    { lineWidth: 0 }
  );
}

/** Raw YAML from disk, or the commented default when the file is missing. */
export function readConfigYaml(dataDir = config.dataDir): string {
  const file = configPath(dataDir);
  try {
    const text = fs.readFileSync(file, "utf8");
    if (text.trim()) return text;
  } catch {
    // missing
  }
  const migrated = migrateLegacy(dataDir);
  if (migrated) {
    writeConfigYaml(migrated, dataDir);
    return migrated;
  }
  return DEFAULT_YAML;
}

export function parseConfigYaml(text: string): AppSettings {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Invalid YAML");
  }
  if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("YAML root must be a mapping");
  }
  const root = asRecord(raw);
  const tv = asRecord(root.tv);
  if (tv.os !== undefined && !isTvOs(tv.os)) {
    throw new Error("tv.os must be webos or android");
  }
  const mcp = asRecord(root.mcp);
  if (mcp.enabled !== undefined && typeof mcp.enabled !== "boolean") {
    throw new Error("mcp.enabled must be a boolean");
  }
  return fromFileShape(raw);
}

export function writeConfigYaml(text: string, dataDir = config.dataDir): AppSettings {
  const parsed = parseConfigYaml(text);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = configPath(dataDir);
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return overlayEnv(parsed);
}

export function readAppSettings(dataDir = config.dataDir): AppSettings {
  try {
    return overlayEnv(parseConfigYaml(readConfigYaml(dataDir)));
  } catch {
    return overlayEnv({ ...DEFAULTS });
  }
}

export function envLockedKeys(): EnvLock[] {
  return envLocks();
}
