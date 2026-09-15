/**
 * Parses Prime Video history + enrichments + metadata into PlaybackObservations.
 *
 * History flattening and metadata interpretation adapted from Universal Trakt
 * Scrobbler src/services/amazon-prime/AmazonPrimeApi.ts
 * (MIT License, Copyright (c) 2020 trakt-tools). See NOTICE.
 */
import { ProviderParseError } from "../errors";
import type { PlaybackObservation } from "../provider";
import type {
  PrimeEnrichmentsResponse,
  PrimeHistoryResponse,
  PrimeHistoryResponseItem,
  PrimeMetadataItem,
} from "./types";

export const PRIME_PARSER_VERSION = "prime-1";

/** Some dubbed/subtitled media append "[version/tag]" to titles (UTS issue #342). */
const VERSION_TAG_REGEX = / \[[\w.]+\/[\w.]+\]$/;

export interface PrimeHistoryEntry {
  gti: string;
  watchedAt: Date;
  raw: unknown;
}

/** Episodes are nested under show entries; leaves are the actual watched titles. */
function flattenItems(items: PrimeHistoryResponseItem[]): PrimeHistoryResponseItem[] {
  return items.flatMap((item) =>
    item.children && item.children.length > 0 ? flattenItems(item.children) : [item]
  );
}

/** Extract watched entries (gti + time) from the watch-history widget. */
export function extractHistoryEntries(response: PrimeHistoryResponse): PrimeHistoryEntry[] {
  const widget = response.widgets?.find((w) => w.widgetType === "watch-history");
  if (!widget) {
    throw new ProviderParseError(
      "prime",
      "No `watch-history` widget in history response. Provider API may have changed."
    );
  }
  const content = widget.content.content;
  if (!("titles" in content)) {
    return []; // empty-history message widget
  }
  const entries: PrimeHistoryEntry[] = [];
  for (const day of content.titles) {
    for (const item of flattenItems(day.titles)) {
      if (typeof item.gti !== "string" || typeof item.time !== "number") {
        throw new ProviderParseError(
          "prime",
          "History item without `gti`/`time`. Provider API may have changed."
        );
      }
      entries.push({ gti: item.gti, watchedAt: new Date(item.time), raw: item });
    }
  }
  return entries;
}

/** Build one observation from a history entry + enrichment progress + metadata. */
export function buildObservation(
  entry: PrimeHistoryEntry,
  enrichments: PrimeEnrichmentsResponse,
  metadata: PrimeMetadataItem | null,
  observedAt: Date
): PlaybackObservation {
  // UTS defaults missing enrichment progress to 100 (fully watched).
  const progress = enrichments.enrichments?.[entry.gti]?.progress?.percentage ?? 100;

  let mediaType: PlaybackObservation["mediaType"] = "unknown";
  let title: string | undefined;
  let showTitle: string | undefined;
  let seasonNumber: number | undefined;
  let episodeNumber: number | undefined;

  const catalog = metadata?.catalogMetadata?.catalog;
  if (catalog) {
    if (catalog.entityType === "TV Show" || catalog.entityType === "Bonus Content") {
      mediaType = "episode";
      title = catalog.title?.trim();
      episodeNumber = catalog.episodeNumber;
      const family = metadata?.catalogMetadata?.family;
      if (family) {
        const [seasonInfo, showInfo] = family.tvAncestors;
        seasonNumber = seasonInfo?.catalog.seasonNumber;
        showTitle = showInfo?.catalog.title?.replace(VERSION_TAG_REGEX, "").trim();
      }
    } else if (catalog.entityType === "Movie") {
      mediaType = "movie";
      title = catalog.title?.replace(VERSION_TAG_REGEX, "").trim();
    }
  }

  return {
    provider: "prime",
    providerContentId: entry.gti,
    mediaType,
    title,
    showTitle,
    seasonNumber,
    episodeNumber,
    progress: Math.min(100, Math.max(0, progress)),
    watchedAt: entry.watchedAt,
    observedAt,
    source: "history",
    raw: { history: entry.raw, metadata },
  };
}
