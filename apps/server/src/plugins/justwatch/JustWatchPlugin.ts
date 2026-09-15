import { logger } from "../../logger";
import { ProviderAuthenticationError } from "../../providers/errors";
import type { ProviderSettings, ProviderStatus } from "../../providers/provider";
import {
  Plugin,
  type ExportResult,
  type PluginContext,
  type PluginEvent,
  type PluginResult,
  type WatchMark,
} from "../plugin";
import { pendingWatched, persistMarks } from "../watched";
import { ensureToken, hasFreshToken, loginWithPassword, searchTitles, setSeen, showSeasons, storedProfile } from "./api";
import { episodesThrough, pickSearchMatch, type SeasonNode } from "./match";

const log = logger.child({ plugin: "justwatch" });

@Plugin({
  id: "justwatch",
  label: "JustWatch",
  description: "Marks locally watched movies and episodes as seen on JustWatch after a sync or a watched action.",
  auth: "credentials",
  fields: [
    { key: "email", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
    { key: "password", label: "Password", type: "secret", required: true },
    {
      key: "country",
      label: "Country",
      type: "text",
      placeholder: "PL",
      help: "ISO country used by JustWatch (e.g. PL, US, DE).",
    },
    { key: "language", label: "Language", type: "text", placeholder: "pl" },
  ],
})
export class JustWatchPlugin {
  private settings: ProviderSettings = { enabled: true, includeData: false, values: {} };

  applySettings(settings: ProviderSettings): void {
    this.settings = settings;
  }

  async login(): Promise<void> {
    const { email, password } = this.creds();
    if (!email || !password) {
      throw new ProviderAuthenticationError("justwatch", "Set the JustWatch email and password in Providers.");
    }
    await loginWithPassword(email, password);
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const { email, password } = this.creds();
    if (hasFreshToken()) return { authenticated: true, profileName: storedProfile() ?? email };
    if (!email || !password) return { authenticated: false };
    try {
      await ensureToken(email, password);
      return { authenticated: true, profileName: storedProfile() ?? email };
    } catch {
      return { authenticated: false };
    }
  }

  async on(_event: PluginEvent, ctx: PluginContext): Promise<PluginResult> {
    const pending = pendingWatched(ctx.db, "justwatch");
    void ctx.log?.("info", "justwatch pending", { count: pending.length });
    const result = await this.exportWatched(pending, ctx.log);
    persistMarks(ctx.db, "justwatch", result.marked);
    return { exported: result.marked.length, unmatched: result.unmatched.length };
  }

  async exportWatched(items: WatchMark[], jobLog?: PluginContext["log"]): Promise<ExportResult> {
    const { email, password, country, language } = this.creds();
    const token = await ensureToken(email, password);
    const marked: ExportResult["marked"] = [];
    const unmatched: string[] = [];
    const showCache = new Map<string, { id: string; seasons: SeasonNode[] }>();
    const alreadySet = new Set<string>();

    for (const item of items) {
      try {
        const remoteIds = await this.resolveIds(token, country, language, item, showCache);
        if (remoteIds.length === 0) {
          unmatched.push(item.key);
          continue;
        }
        for (const remoteId of remoteIds) {
          if (alreadySet.has(remoteId)) continue;
          const id = await setSeen(token, country, language, remoteId);
          if (!id) continue;
          alreadySet.add(remoteId);
        }
        const targetId = remoteIds[remoteIds.length - 1]!;
        if (!alreadySet.has(targetId)) {
          unmatched.push(item.key);
          continue;
        }
        marked.push({ key: item.key, remoteId: targetId });
      } catch (err) {
        if (err instanceof ProviderAuthenticationError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ key: item.key, err: message }, "justwatch mark failed");
        void jobLog?.("warn", "justwatch mark failed", { key: item.key, err: message });
        unmatched.push(item.key);
      }
    }

    log.info({ marked: marked.length, unmatched: unmatched.length }, "justwatch export finished");
    void jobLog?.("info", "justwatch export finished", {
      marked: marked.length,
      unmatched: unmatched.length,
    });
    return { marked, unmatched };
  }

  private creds(): { email: string; password: string; country: string; language: string } {
    return {
      email: this.settings.values.email ?? "",
      password: this.settings.values.password ?? "",
      country: (this.settings.values.country ?? "PL").trim().toUpperCase() || "PL",
      language: (this.settings.values.language ?? "pl").trim().toLowerCase() || "pl",
    };
  }

  private async resolveIds(
    token: Awaited<ReturnType<typeof ensureToken>>,
    country: string,
    language: string,
    item: WatchMark,
    showCache: Map<string, { id: string; seasons: SeasonNode[] }>
  ): Promise<string[]> {
    if (item.mediaType === "movie") {
      const title = item.title?.trim();
      if (!title) return [];
      const nodes = await searchTitles(token, country, language, title, "MOVIE");
      const id = pickSearchMatch(nodes, { title, tmdbId: item.tmdbId, year: item.year });
      return id ? [id] : [];
    }
    if (item.mediaType !== "episode" || item.seasonNumber == null || item.episodeNumber == null) {
      return [];
    }
    const showTitle = (item.showTitle ?? item.title)?.trim();
    if (!showTitle) return [];
    const cacheKey = `${showTitle}|${item.tmdbId ?? ""}`;
    let show = showCache.get(cacheKey);
    if (!show) {
      const nodes = await searchTitles(token, country, language, showTitle, "SHOW");
      const id = pickSearchMatch(nodes, { title: showTitle, tmdbId: item.tmdbId, year: item.year });
      if (!id) return [];
      show = { id, seasons: await showSeasons(token, country, language, id) };
      showCache.set(cacheKey, show);
    }
    return episodesThrough(show.seasons, item.seasonNumber, item.episodeNumber);
  }
}
