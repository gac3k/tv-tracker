import { readAppSettings } from "../settings/app-settings";

export type TmdbKeySource = "env" | "settings" | null;

export function tmdbApiKey(dataDir?: string): string | undefined {
  return readAppSettings(dataDir).tmdbApiKey;
}

export function tmdbApiKeySource(dataDir?: string): TmdbKeySource {
  if (process.env.TMDB_API_KEY?.trim()) return "env";
  return tmdbApiKey(dataDir) ? "settings" : null;
}
