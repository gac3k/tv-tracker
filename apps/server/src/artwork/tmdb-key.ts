import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const KEY_FILE = "tmdb.api_key";

export type TmdbKeySource = "env" | "settings" | null;

function keyPath(dataDir = config.dataDir): string {
  return path.join(dataDir, KEY_FILE);
}

export function tmdbApiKey(dataDir = config.dataDir): string | undefined {
  const fromEnv = process.env.TMDB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(keyPath(dataDir), "utf8").trim();
    return fromFile || undefined;
  } catch {
    return undefined;
  }
}

export function tmdbApiKeySource(dataDir = config.dataDir): TmdbKeySource {
  if (process.env.TMDB_API_KEY?.trim()) return "env";
  return tmdbApiKey(dataDir) ? "settings" : null;
}

export function setTmdbApiKey(value: string, dataDir = config.dataDir): void {
  const file = keyPath(dataDir);
  const trimmed = value.trim();
  if (!trimmed) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
    return;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, `${trimmed}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
