import { z } from "zod";
import path from "node:path";

// Load .env if present (Node >= 20.12 native loader); ignore when missing.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default(".data"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Minutes between sync jobs. 0 disables the scheduler (manual/CLI still work). */
  SYNC_INTERVAL_MINUTES: z.coerce.number().min(0).optional(),
  /** @deprecated use SYNC_INTERVAL_MINUTES */
  NETFLIX_SYNC_INTERVAL_MINUTES: z.coerce.number().min(0).optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  SYNC_PAGES: z.coerce.number().int().min(1).default(2),
  WATCHED_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(85),
  SESSION_GAP_MINUTES: z.coerce.number().positive().default(60),
  NOW_PLAYING_WINDOW_MINUTES: z.coerce.number().positive().default(30),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
  /** Free TMDB API key (themoviedb.org). Without it, artwork lookups are skipped. */
  TMDB_API_KEY: z.string().optional(),
  TMDB_LANGUAGE: z.string().default("en-US"),
  BETTER_AUTH_SECRET: z.string().min(32).default("tv-tracker-dev-secret-change-me-32b"),
  AUTH_BASE_URL: z.string().default("http://127.0.0.1:3001"),
  /** Extra CSRF origins, comma-separated. Appended to the built-in defaults. */
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
});

const env = envSchema.parse(process.env);

export function parseTrustedOrigins(baseUrl: string, extra = ""): string[] {
  return [
    ...new Set([
      baseUrl,
      "http://127.0.0.1:3001",
      "http://localhost:3001",
      // prefix-less: any protocol. login Origin is the web host, not the API.
      "*.lan",
      "*.homelab.lan",
      ...extra.split(",").map((origin) => origin.trim()).filter(Boolean),
    ]),
  ];
}

export const config = {
  ...env,
  /** Default: hourly. Falls back to the old Netflix-named env var when unset. */
  SYNC_INTERVAL_MINUTES: env.SYNC_INTERVAL_MINUTES ?? env.NETFLIX_SYNC_INTERVAL_MINUTES ?? 60,
  dataDir: path.resolve(env.DATA_DIR),
  dbPath: path.resolve(env.DATA_DIR, "vod-tracker.sqlite"),
  browserProfileDir: (provider: string) => path.resolve(env.DATA_DIR, "browser", provider),
  fixturesDir: (provider: string) => path.resolve(env.DATA_DIR, "fixtures", provider),
  AUTH_TRUSTED_ORIGINS: parseTrustedOrigins(env.AUTH_BASE_URL, env.AUTH_TRUSTED_ORIGINS),
};

export type Config = typeof config;
