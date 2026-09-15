// Server-side API client. Response shapes mirror @vod/server REST responses.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000";

export const PROVIDER_LABELS: Record<string, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  max: "Max",
  apple: "Apple TV",
  disney: "Disney+",
  jellyfin: "Jellyfin",
  justwatch: "JustWatch",
  mcp: "MCP",
};

export interface ProviderField {
  key: string;
  label: string;
  type: "url" | "text" | "secret";
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderCatalogItem {
  id: string;
  label: string;
  description: string | null;
  auth: "browser" | "credentials" | "none";
  kind: "source" | "plugin";
  exportWatched: boolean;
  fields: ProviderField[];
  enabled: boolean;
  includeData: boolean;
  values: Record<string, string | null>;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
}

export interface ProviderStatus {
  provider: string;
  authenticated: boolean | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
}

export interface Artwork {
  posterUrl: string | null;
  backdropUrl: string | null;
  stillUrl: string | null;
  tmdbId: number | null;
  tmdbType: string | null;
  runtimeSeconds: number | null;
}

export interface LibraryCard {
  key: string;
  provider: string;
  providerContentId: string;
  mediaType: string;
  title: string | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progress: number | null;
  progressSource: "provider" | "derived" | null;
  remainingSeconds: number | null;
  completed: boolean;
  source?: string;
  watchedAt: string | null;
  observedAt: string;
  observationCount: number;
  artwork: Artwork | null;
  url: string | null;
  providers?: string[];
  episodeCount?: number;
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
}

export interface LibraryResponse {
  items: LibraryCard[];
  total: number;
  facets: {
    providers: { provider: string; count: number }[];
    mediaTypes: { mediaType: string; count: number }[];
  };
  artworkEnabled: boolean;
}

export interface NowPlaying {
  active: boolean;
  provider?: string;
  content?: {
    title: string | null;
    showTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
  };
  progress?: number | null;
  confidence?: number;
  lastObservedAt?: string;
}

export interface JobRun {
  id: number;
  queueJobId: string | null;
  name: string;
  provider: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: { results?: JobProviderResult[] } | null;
  error: string | null;
  errorType: string | null;
}

export interface JobProviderResult {
  provider: string;
  status: string;
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

export interface JobLogLine {
  id: number;
  ts: string;
  level: string;
  message: string;
  data: unknown;
}

export interface JobRunDetail extends JobRun {
  logs: JobLogLine[];
}

export interface JobTarget {
  id: string;
  label: string;
  kind: "source" | "plugin";
}

export interface JobsResponse {
  intervalMinutes: number;
  targets: JobTarget[];
  jobs: JobRun[];
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  providers: () => get<{ providers: ProviderCatalogItem[] }>("/providers"),
  status: (provider: string) => get<ProviderStatus>(`/providers/${provider}/status`),
  jobs: () => get<JobsResponse>("/jobs"),
  job: (id: number) => get<JobRunDetail>(`/jobs/${id}`),
  async allStatuses(): Promise<ProviderStatus[]> {
    const list = await this.providers();
    if (!list) return [];
    return list.providers.map((p) => ({
      provider: p.id,
      authenticated: p.lastSyncStatus === "auth_required" ? false : p.lastSyncStatus === "success" ? true : null,
      lastSyncAt: p.lastSyncAt,
      lastSuccessAt: p.lastSuccessAt,
      lastSyncStatus: p.lastSyncStatus,
      lastError: p.lastError,
    }));
  },
  library: (search: string) => get<LibraryResponse>(`/library${search ? `?${search}` : ""}`),
  nowPlaying: () => get<NowPlaying>("/now-playing"),
  watchlist: () => get<{ items: WatchlistItem[] }>("/watchlist"),
  upcoming: () => get<{ items: UpcomingItem[]; tmdbEnabled: boolean }>("/upcoming"),
  catalogSearch: (q: string) =>
    get<{ items: CatalogHit[]; tmdbEnabled: boolean }>(`/catalog/search?q=${encodeURIComponent(q)}`),
  shows: () => get<{ items: ShowListItem[]; tmdbEnabled: boolean }>("/shows"),
  show: (tmdbId: number) => get<ShowCatalog>(`/shows/tv/${tmdbId}`),
};

export interface WatchlistItem {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  posterUrl: string | null;
  addedAt: string;
}

export interface UpcomingItem {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  posterUrl: string | null;
  airDate: string;
  kind: "movie" | "series" | "season";
  seasonNumber: number | null;
  episodeNumber: number | null;
  subtitle: string;
  source: "library" | "watchlist";
}

export interface CatalogHit {
  tmdbId: number;
  tmdbType: "tv" | "movie";
  title: string;
  year?: number;
  posterPath?: string;
  posterUrl: string | null;
  onWatchlist: boolean;
}

export async function libraryAction(
  action: "watched" | "hidden" | "restore",
  keys: string[]
): Promise<{ updated: number }> {
  const res = await fetch("/api/library/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, keys }),
  });
  if (!res.ok) {
    throw new Error(`library action failed (${res.status})`);
  }
  return (await res.json()) as { updated: number };
}

export async function watchlistAdd(item: {
  tmdbType: "tv" | "movie";
  tmdbId: number;
  title: string;
  posterPath?: string | null;
}): Promise<WatchlistItem> {
  const res = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`watchlist add failed (${res.status})`);
  return (await res.json()) as WatchlistItem;
}

export async function watchlistRemove(tmdbType: "tv" | "movie", tmdbId: number): Promise<void> {
  const res = await fetch(`/api/watchlist/${tmdbType}/${tmdbId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`watchlist remove failed (${res.status})`);
}

export async function showProgress(
  tmdbType: "tv" | "movie",
  tmdbId: number,
  body: {
    mark: "caught_up" | "season" | "episode" | "watched";
    season?: number;
    episode?: number;
    watched?: boolean;
  }
): Promise<{ updated: number }> {
  const res = await fetch(`/api/shows/${tmdbType}/${tmdbId}/progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`show progress failed (${res.status})`);
  return (await res.json()) as { updated: number };
}

export interface ShowListItem {
  key: string;
  tmdbId: number | null;
  tmdbType: "tv" | "movie" | null;
  title: string;
  posterUrl: string | null;
  providers: string[];
  sources: Array<"library" | "watchlist">;
  progress: string | null;
  canCatchUp: boolean;
}

export interface ShowEpisode {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  stillUrl: string | null;
  aired: boolean;
  watched: boolean;
  locked: boolean;
}

export interface ShowSeason {
  seasonNumber: number;
  name: string;
  watched: number;
  total: number;
  userMarked: boolean;
  episodes: ShowEpisode[];
}

export interface ShowCatalog {
  tmdbId: number;
  tmdbType: "tv";
  title: string;
  posterUrl: string | null;
  following: boolean;
  seasons: ShowSeason[];
}
