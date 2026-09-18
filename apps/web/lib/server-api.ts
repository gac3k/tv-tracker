import { cookies } from "next/headers";
import {
  apiUrl,
  type CatalogHit,
  type JobRunDetail,
  type JobsResponse,
  type LibraryResponse,
  type NowPlaying,
  type ProviderCatalogItem,
  type ProviderStatus,
  type ShowCatalog,
  type ShowListItem,
  type UpcomingItem,
  type WatchlistItem,
} from "./api";

async function get<T>(path: string): Promise<T | null> {
  try {
    const cookie = (await cookies()).toString();
    const res = await fetch(`${apiUrl()}${path}`, {
      cache: "no-store",
      headers: cookie ? { cookie } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  providers: () => get<{ providers: ProviderCatalogItem[] }>("/providers"),
  extension: () => get<{ token: string }>("/extension"),
  settings: () =>
    get<{
      version: string;
      tmdbApiKeySet: boolean;
      tmdbApiKeySource: "env" | "settings" | null;
      mcpEnabled: boolean;
      tvOs: "webos" | "android";
    }>("/settings"),
  health: () => get<{ status: string; version: string }>("/health"),
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

export async function getSession(): Promise<{
  user: { id: string; name: string; username?: string | null };
} | null> {
  return get("/api/auth/get-session");
}
