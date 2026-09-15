import { Inject, Injectable, Optional } from "@nestjs/common";
import { SyncQueue } from "../jobs/sync.queue";
import { desc, inArray } from "drizzle-orm";
import { ArtworkService, type ResolvedArtwork } from "../artwork/artwork.service";
import { fetchTvDetails, isTmdbEnabled, type TmdbTvDetails } from "../artwork/tmdb";
import { config } from "../config";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { libraryOverrides, providerObservations, tmdbDetails } from "../db/schema";
import { lastAvailableEpisode, todayStamp, unwrapTvDetails } from "../watchlist/upcoming";
import {
  aggregateObservations,
  applyDerivedProgress,
  groupByTitle,
  isContinueTitle,
  isInProgress,
  titleIdentityKey,
  type LibraryItem,
  type TitleGroup,
} from "./aggregate";
import { applyOverride, isHidden, overrideMap, type OverrideAction } from "./overrides";
import { pickPlayback, toPlaybackLaunch, type PlaybackLaunch } from "./playback";
import { logger } from "../logger";
import { PluginRegistry } from "../plugins/registry.service";
import { ProviderRegistry } from "../providers/registry.service";
import { providerUrl } from "./deepLink";

export type LibraryStatus = "all" | "in_progress" | "completed" | "unwatched";
export type LibrarySort = "recent" | "progress" | "title";
export type LibraryView = "episodes" | "titles";
export type LibraryTracking = "active" | "removed";

export interface LibraryQuery {
  providers?: string[];
  mediaType?: "movie" | "episode";
  status?: LibraryStatus;
  q?: string;
  sort?: LibrarySort;
  limit?: number;
  view?: LibraryView;
  tracking?: LibraryTracking;
}

export interface LibraryCard extends LibraryItem {
  artwork: ResolvedArtwork | null;
  /** Deep link into the provider's web player, when we can build one. */
  url: string | null;
  /** Present on `view=titles`: every VOD this title was seen on. */
  providers?: string[];
  /** Present on `view=titles`: episode/movie rows collapsed into this card. */
  episodeCount?: number;
  /** Latest aired episode from TMDB, when known. Watch Next uses this to hide caught-up series. */
  lastAiredSeason?: number | null;
  lastAiredEpisode?: number | null;
}

export interface LibraryResponse {
  items: LibraryCard[];
  total: number;
  /** Facet counts for the filter bar, computed before status/type filtering. */
  facets: {
    providers: { provider: string; count: number }[];
    mediaTypes: { mediaType: string; count: number }[];
  };
  artworkEnabled: boolean;
}

function matchesQuery(item: LibraryItem, q: string): boolean {
  const haystack = `${item.showTitle ?? ""} ${item.title ?? ""}`.toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function matchesStatus(item: LibraryItem, status: LibraryStatus): boolean {
  switch (status) {
    case "completed":
      return item.completed;
    case "in_progress":
      return isInProgress(item);
    case "unwatched":
      return !isInProgress(item) && !item.completed;
    default:
      return true;
  }
}

function toTitleCard(group: TitleGroup<LibraryCard>): LibraryCard {
  return {
    ...group.latest,
    key: `title:${group.key}`,
    watchedAt: group.lastWatched,
    observedAt: group.lastWatched,
    providers: group.providers,
    episodeCount: group.episodeCount,
  };
}

function sortCards(cards: LibraryCard[], sort: LibrarySort): void {
  cards.sort((a, b) => {
    if (sort === "progress") {
      return (b.progress ?? -1) - (a.progress ?? -1);
    }
    if (sort === "title") {
      const at = (a.showTitle ?? a.title ?? "").toLowerCase();
      const bt = (b.showTitle ?? b.title ?? "").toLowerCase();
      return at.localeCompare(bt);
    }
    const at = (a.watchedAt ?? a.observedAt).getTime();
    const bt = (b.watchedAt ?? b.observedAt).getTime();
    return bt - at;
  });
}

@Injectable()
export class LibraryService {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ArtworkService) private readonly artworkService: ArtworkService,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Optional() @Inject(PluginRegistry) private readonly plugins?: PluginRegistry,
    @Optional() @Inject(SyncQueue) private readonly queue?: SyncQueue
  ) {}

  async list(query: LibraryQuery = {}): Promise<LibraryResponse> {
    const hidden = this.registry.hiddenProviders();
    const observations = this.db
      .select()
      .from(providerObservations)
      .orderBy(desc(providerObservations.observedAt))
      .all()
      .filter((row) => !hidden.has(row.provider));

    const all = aggregateObservations(observations, config.WATCHED_THRESHOLD_PERCENT);
    const overrides = overrideMap(this.db.select().from(libraryOverrides).all());
    const tracking = query.tracking ?? "active";
    let items =
      tracking === "removed"
        ? all.filter((item) => isHidden(item, overrides))
        : all.filter((item) => !isHidden(item, overrides));

    // Facets describe the current tracking set, so hidden titles don't inflate counts.
    const providerCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    for (const item of items) {
      providerCounts.set(item.provider, (providerCounts.get(item.provider) ?? 0) + 1);
      typeCounts.set(item.mediaType, (typeCounts.get(item.mediaType) ?? 0) + 1);
    }
    if (query.providers?.length) {
      const wanted = new Set(query.providers);
      items = items.filter((i) => wanted.has(i.provider));
    }
    if (query.mediaType) {
      items = items.filter((i) => i.mediaType === query.mediaType);
    }
    if (query.q?.trim()) {
      items = items.filter((i) => matchesQuery(i, query.q!.trim()));
    }

    // Artwork also supplies runtime, which is what turns "42 min left" into a
    // percentage — so resolve it before status filtering and sorting.
    const artworkById = await this.artworkService.resolveMany(
      items.map((item) => ({
        id: item.key,
        mediaType: item.mediaType,
        searchTitle: item.mediaType === "episode" ? (item.showTitle ?? undefined) : (item.title ?? undefined),
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
      }))
    );

    let cards: LibraryCard[] = items.map((item) => {
      const artwork = artworkById.get(item.key) ?? null;
      const withProgress = applyDerivedProgress(
        item,
        artwork?.runtimeSeconds ?? null,
        config.WATCHED_THRESHOLD_PERCENT
      );
      return {
        ...applyOverride(
          withProgress,
          overrides,
          artwork?.tmdbId && artwork.tmdbType
            ? { id: artwork.tmdbId, type: artwork.tmdbType }
            : null
        ),
        artwork,
        url: providerUrl(item.provider, item.providerContentId, item.mediaType, {
          jellyfinServerUrl: this.registry.readSettings("jellyfin").values.serverUrl,
        }),
      };
    });

    const status = query.status ?? "all";
    const sort = query.sort ?? "recent";

    if (tracking === "removed") {
      const titleHidden = new Set(
        [...overrides]
          .filter(([key, action]) => action === "hidden" && key.startsWith("title:"))
          .map(([key]) => key)
      );
      const titleCards = groupByTitle(cards)
        .filter((group) => titleHidden.has(`title:${group.key}`))
        .map(toTitleCard);
      cards = [...titleCards, ...cards.filter((card) => !titleHidden.has(titleIdentityKey(card)))];
      if (status !== "all") {
        cards = cards.filter((c) => matchesStatus(c, status));
      }
      sortCards(cards, sort);
      return {
        items: cards.slice(0, query.limit ?? 200),
        total: cards.length,
        facets: {
          providers: [...providerCounts]
            .map(([provider, count]) => ({ provider, count }))
            .sort((a, b) => b.count - a.count),
          mediaTypes: [...typeCounts].map(([mediaType, count]) => ({ mediaType, count })),
        },
        artworkEnabled: this.artworkService.enabled,
      };
    }

    if ((query.view ?? "episodes") === "titles") {
      const groups = groupByTitle(cards);
      const titleProviderCounts = new Map<string, number>();
      const titleTypeCounts = new Map<string, number>();
      for (const group of groups) {
        for (const provider of group.providers) {
          titleProviderCounts.set(provider, (titleProviderCounts.get(provider) ?? 0) + 1);
        }
        titleTypeCounts.set(group.latest.mediaType, (titleTypeCounts.get(group.latest.mediaType) ?? 0) + 1);
      }

      let titles: LibraryCard[] = groups.map(toTitleCard);
      if (status === "in_progress") {
        titles = titles.filter(isContinueTitle);
        await this.attachLastAired(titles);
      } else if (status !== "all") {
        titles = titles.filter((card) => matchesStatus(card, status));
      }
      sortCards(titles, sort);
      return {
        items: titles.slice(0, query.limit ?? 200),
        total: titles.length,
        facets: {
          providers: [...titleProviderCounts]
            .map(([provider, count]) => ({ provider, count }))
            .sort((a, b) => b.count - a.count),
          mediaTypes: [...titleTypeCounts].map(([mediaType, count]) => ({ mediaType, count })),
        },
        artworkEnabled: this.artworkService.enabled,
      };
    }

    if (status !== "all") {
      cards = cards.filter((c) => matchesStatus(c, status));
    }
    sortCards(cards, sort);

    const total = cards.length;
    return {
      items: cards.slice(0, query.limit ?? 200),
      total,
      facets: {
        providers: [...providerCounts]
          .map(([provider, count]) => ({ provider, count }))
          .sort((a, b) => b.count - a.count),
        mediaTypes: [...typeCounts].map(([mediaType, count]) => ({ mediaType, count })),
      },
      artworkEnabled: this.artworkService.enabled,
    };
  }

  private async attachLastAired(cards: LibraryCard[]): Promise<void> {
    if (!isTmdbEnabled()) return;
    const targets = cards.filter(
      (card) =>
        card.mediaType === "episode" &&
        card.completed &&
        card.artwork?.tmdbType === "tv" &&
        card.artwork.tmdbId
    );
    if (targets.length === 0) return;

    const ids = [...new Set(targets.map((card) => card.artwork!.tmdbId!))];
    const tvById = await this.loadTvDetails(ids);
    const today = todayStamp();
    for (const card of targets) {
      const tv = tvById.get(card.artwork!.tmdbId!);
      if (!tv) continue;
      const last = lastAvailableEpisode(tv, today);
      if (!last) continue;
      card.lastAiredSeason = last.season;
      card.lastAiredEpisode = last.episode;
    }
  }

  // ponytail: sequential TMDB fetches for cache misses; pool if the shelf is huge
  private async loadTvDetails(ids: number[]): Promise<Map<number, TmdbTvDetails>> {
    const out = new Map<number, TmdbTvDetails>();
    const keys = ids.map((id) => `tv:${id}`);
    const rows =
      keys.length === 0
        ? []
        : this.db.select().from(tmdbDetails).where(inArray(tmdbDetails.cacheKey, keys)).all();
    const rowByKey = new Map(rows.map((row) => [row.cacheKey, row]));
    const stale: number[] = [];
    const ttlMs = 12 * 60 * 60 * 1000;
    for (const id of ids) {
      const row = rowByKey.get(`tv:${id}`);
      const tv = unwrapTvDetails(row?.payload);
      if (tv) out.set(id, tv);
      if (!tv || !row || Date.now() - row.updatedAt.getTime() >= ttlMs) stale.push(id);
    }
    for (const id of stale) {
      try {
        const tv = await fetchTvDetails(id);
        if (!tv) continue;
        const now = new Date();
        this.db
          .insert(tmdbDetails)
          .values({ cacheKey: `tv:${id}`, payload: tv, updatedAt: now })
          .onConflictDoUpdate({
            target: tmdbDetails.cacheKey,
            set: { payload: tv, updatedAt: now },
          })
          .run();
        out.set(id, tv);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), tmdbId: id },
          "TMDB show failed"
        );
      }
    }
    return out;
  }

  applyActions(action: OverrideAction | "restore", keys: string[]): { updated: number } {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return { updated: 0 };
    if (action === "restore") {
      this.db.delete(libraryOverrides).where(inArray(libraryOverrides.key, unique)).run();
      return { updated: unique.length };
    }
    const now = new Date();
    for (const key of unique) {
      this.db
        .insert(libraryOverrides)
        .values({ key, action, updatedAt: now })
        .onConflictDoUpdate({
          target: libraryOverrides.key,
          set: { action, updatedAt: now },
        })
        .run();
    }
    if (action === "watched") this.notifyWatched(unique);
    return { updated: unique.length };
  }

  /** ponytail: one job per plugin per mark; coalesce if JustWatch rate-limits. */
  private notifyWatched(keys: string[]): void {
    const plugins = this.plugins?.all().filter((entry) => entry.settings.enabled && entry.instance.on) ?? [];
    if (plugins.length === 0) return;
    if (this.queue) {
      for (const plugin of plugins) {
        void this.queue.enqueue({ trigger: "manual", provider: plugin.meta.id }).catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), plugin: plugin.meta.id },
            "plugin watched enqueue failed"
          );
          void this.plugins?.emit({ type: "watched", keys }, plugin.meta.id).catch((emitErr) => {
            logger.warn(
              { err: emitErr instanceof Error ? emitErr.message : String(emitErr) },
              "plugin watched emit failed"
            );
          });
        });
      }
      return;
    }
    void this.plugins?.emit({ type: "watched", keys }).catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "plugin watched emit failed");
    });
  }

  /** Title → webOS launch payload for Assist / MCP. */
  resolvePlayback(query: string): PlaybackLaunch | null {
    const hidden = this.registry.hiddenProviders();
    const observations = this.db
      .select()
      .from(providerObservations)
      .orderBy(desc(providerObservations.observedAt))
      .all()
      .filter((row) => !hidden.has(row.provider));
    const items = aggregateObservations(observations, config.WATCHED_THRESHOLD_PERCENT);
    const overrides = overrideMap(this.db.select().from(libraryOverrides).all());
    const visible = items.filter((item) => !isHidden(item, overrides));
    const picked = pickPlayback(visible, query);
    if (!picked) return null;
    return toPlaybackLaunch(picked, query.trim(), {
      jellyfinServerUrl: this.registry.readSettings("jellyfin").values.serverUrl,
    });
  }
}
