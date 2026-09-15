import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core";

export const providerObservations = sqliteTable(
  "provider_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Deterministic identity hash — prevents endless duplicates on polling. */
    fingerprint: text("fingerprint").notNull().unique(),
    provider: text("provider").notNull(),
    profileId: text("profile_id"),
    providerContentId: text("provider_content_id").notNull(),
    mediaType: text("media_type").notNull(),
    title: text("title"),
    showTitle: text("show_title"),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    progress: real("progress"),
    positionSeconds: real("position_seconds"),
    durationSeconds: real("duration_seconds"),
    watchedAt: integer("watched_at", { mode: "timestamp_ms" }),
    observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
    source: text("source").notNull(),
    raw: text("raw", { mode: "json" }).notNull(),
    parserVersion: text("parser_version").notNull(),
  },
  (t) => [
    index("obs_provider_content_idx").on(t.provider, t.providerContentId),
    index("obs_observed_at_idx").on(t.observedAt),
    index("obs_watched_at_idx").on(t.watchedAt),
  ]
);

/** Derived playback sessions, rebuilt from observations. Not authoritative. */
export const playbackSessions = sqliteTable(
  "playback_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    profileId: text("profile_id"),
    providerContentId: text("provider_content_id").notNull(),
    mediaType: text("media_type").notNull(),
    title: text("title"),
    showTitle: text("show_title"),
    seasonNumber: integer("season_number"),
    episodeNumber: integer("episode_number"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
    startProgress: real("start_progress"),
    endProgress: real("end_progress"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    observationCount: integer("observation_count").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sess_provider_content_idx").on(t.provider, t.providerContentId)]
);

export const syncState = sqliteTable("sync_state", {
  provider: text("provider").primaryKey(),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastSyncStatus: text("last_sync_status"),
  lastError: text("last_error"),
  lastObservationCount: integer("last_observation_count"),
});

/**
 * TMDB lookup cache: artwork + runtime per resolved title. Keyed by a normalized
 * search key so repeated syncs never re-hit the API. `notFound` is a negative
 * cache — without it every unmatched title would be re-queried forever.
 */
export const artwork = sqliteTable("artwork", {
  cacheKey: text("cache_key").primaryKey(),
  tmdbId: integer("tmdb_id"),
  tmdbType: text("tmdb_type"),
  title: text("title"),
  year: integer("year"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  stillPath: text("still_path"),
  runtimeSeconds: real("runtime_seconds"),
  notFound: integer("not_found", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Per-provider UI settings: toggles + credential/config values. */
export const providerSettings = sqliteTable("provider_settings", {
  provider: text("provider").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  includeData: integer("include_data", { mode: "boolean" }).notNull().default(true),
  config: text("config", { mode: "json" }).notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * One row per sync (or other) job. BullMQ is the scheduler; these rows are the
 * durable log the System > Jobs UI reads — Redis job history expires.
 */
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    queueJobId: text("queue_job_id"),
    name: text("name").notNull(),
    provider: text("provider"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    summary: text("summary", { mode: "json" }),
    error: text("error"),
    errorType: text("error_type"),
  },
  (t) => [index("job_runs_started_idx").on(t.startedAt)]
);

export const jobLogs = sqliteTable(
  "job_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    data: text("data", { mode: "json" }),
  },
  (t) => [index("job_logs_run_idx").on(t.runId)]
);

/**
 * Local user actions on library cards. `key` is either `provider:contentId`
 * (one episode/movie) or `title:<normalized title>` (the whole show/film).
 * Hidden keys drop off Watching/History; watched keys count as completed.
 */
export const libraryOverrides = sqliteTable("library_overrides", {
  key: text("key").primaryKey(),
  action: text("action").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Titles already pushed to an export sink. `contentKey` is `provider:contentId`
 * from the local library — re-syncs skip rows that are already here.
 */
export const exportMarks = sqliteTable(
  "export_marks",
  {
    sink: text("sink").notNull(),
    contentKey: text("content_key").notNull(),
    remoteId: text("remote_id").notNull(),
    exportedAt: integer("exported_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sink, t.contentKey] })]
);

/** Titles the user wants to track before (or besides) a provider observation. */
export const watchlist = sqliteTable(
  "watchlist",
  {
    tmdbType: text("tmdb_type").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    posterPath: text("poster_path"),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tmdbType, t.tmdbId] })]
);

/** Cached TMDB title details used to derive upcoming premieres / seasons. */
export const tmdbDetails = sqliteTable("tmdb_details", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type ExportMarkRow = typeof exportMarks.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;
export type TmdbDetailsRow = typeof tmdbDetails.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type JobLogRow = typeof jobLogs.$inferSelect;
export type LibraryOverrideRow = typeof libraryOverrides.$inferSelect;

export type ProviderSettingsRow = typeof providerSettings.$inferSelect;

export type ArtworkRow = typeof artwork.$inferSelect;

export type ObservationRow = typeof providerObservations.$inferSelect;
export type NewObservationRow = typeof providerObservations.$inferInsert;
export type SessionRow = typeof playbackSessions.$inferSelect;
export type NewSessionRow = typeof playbackSessions.$inferInsert;
