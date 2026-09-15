/**
 * Parses Netflix history + metadata payloads into normalized PlaybackObservations.
 *
 * Progress formula and season/episode matching adapted from Universal Trakt
 * Scrobbler src/services/netflix/NetflixProgress.ts and NetflixApi.ts
 * (MIT License, Copyright (c) 2020 trakt-tools). See NOTICE.
 */
import { z } from "zod";
import { ProviderParseError } from "../errors";
import type { PlaybackObservation } from "../provider";
import type {
  NetflixHistoryItem,
  NetflixMetadataShowEpisode,
  NetflixSingleMetadataItem,
} from "./types";

export const NETFLIX_PARSER_VERSION = "netflix-1";

const historyItemSchema = z.object({
  movieID: z.number(),
  title: z.string(),
  date: z.number(),
  bookmark: z.number().optional(),
  duration: z.number().optional(),
  series: z.number().optional(),
  seriesTitle: z.string().optional(),
  episodeTitle: z.string().optional(),
});

/** clamp((bookmark / duration) * 100), floored to 2 decimals; undefined when unknown. */
export function calculateProgress(
  bookmark: number | null | undefined,
  duration: number | null | undefined
): number | undefined {
  if (
    typeof bookmark !== "number" ||
    !Number.isFinite(bookmark) ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return undefined;
  }
  const progress = Math.min(100, Math.max(0, (bookmark / duration) * 100));
  return Math.floor(progress * 100) / 100;
}

export interface EpisodeMetadataMatch {
  seasonNumber?: number;
  episodeNumber?: number;
  showTitle?: string;
  episodeTitle?: string;
  bookmark?: number;
  duration?: number;
}

/**
 * Find the episode of `historyItem.movieID` inside show metadata and extract
 * canonical season/episode numbers. Collections (`hiddenEpisodeNumbers`) keep
 * numbers undefined because Netflix numbering is not canonical there.
 */
export function matchEpisodeMetadata(
  metadata: NetflixSingleMetadataItem | null,
  episodeId: number
): EpisodeMetadataMatch | null {
  const video = metadata?.video;
  if (!video || video.type !== "show" || !video.seasons) {
    return null;
  }
  for (const season of video.seasons) {
    let episode: NetflixMetadataShowEpisode | undefined;
    for (const candidate of season.episodes) {
      if (candidate.id === episodeId) {
        episode = candidate;
        break;
      }
    }
    if (!episode) {
      continue;
    }
    const match: EpisodeMetadataMatch = {
      showTitle: video.title,
      episodeTitle: episode.title,
    };
    if (video.hiddenEpisodeNumbers !== true) {
      match.seasonNumber = season.seq;
      match.episodeNumber = episode.seq;
    }
    // Metadata bookmark is fresher than the history one when both exist.
    if (typeof episode.bookmark?.offset === "number" && typeof episode.runtime === "number") {
      match.bookmark = episode.bookmark.offset;
      match.duration = episode.runtime;
    }
    return match;
  }
  return null;
}

/** Parse a single raw history item (+ optional metadata) into an observation. */
export function parseHistoryItem(
  rawItem: unknown,
  metadata: NetflixSingleMetadataItem | null,
  observedAt: Date
): PlaybackObservation {
  const parsed = historyItemSchema.safeParse(rawItem);
  if (!parsed.success) {
    throw new ProviderParseError(
      "netflix",
      `Unrecognized history item shape: ${parsed.error.issues[0]?.message ?? "unknown issue"}. ` +
        "Provider API may have changed.",
      { cause: parsed.error }
    );
  }
  const item = parsed.data;
  const isEpisode = item.series !== undefined;

  let bookmark = item.bookmark;
  let duration = item.duration;
  let seasonNumber: number | undefined;
  let episodeNumber: number | undefined;
  let title = isEpisode ? item.episodeTitle?.trim() : item.title.trim();
  let showTitle = isEpisode ? item.seriesTitle?.trim() : undefined;

  if (isEpisode) {
    const match = matchEpisodeMetadata(metadata, item.movieID);
    if (match) {
      seasonNumber = match.seasonNumber;
      episodeNumber = match.episodeNumber;
      title = match.episodeTitle?.trim() || title;
      showTitle = match.showTitle?.trim() || showTitle;
      if (match.bookmark !== undefined && match.duration !== undefined) {
        bookmark = match.bookmark;
        duration = match.duration;
      }
    }
  } else if (metadata?.video && metadata.video.type === "movie") {
    title = metadata.video.title?.trim() || title;
    if (
      typeof metadata.video.bookmark?.offset === "number" &&
      typeof metadata.video.runtime === "number"
    ) {
      bookmark = metadata.video.bookmark.offset;
      duration = metadata.video.runtime;
    }
  }

  return {
    provider: "netflix",
    providerContentId: String(item.movieID),
    mediaType: isEpisode ? "episode" : "movie",
    title,
    showTitle,
    seasonNumber,
    episodeNumber,
    progress: calculateProgress(bookmark, duration),
    positionSeconds: bookmark,
    durationSeconds: duration,
    watchedAt: item.date > 0 ? new Date(item.date) : undefined,
    observedAt,
    source: "history",
    raw: rawItem,
  };
}

/** Group history items by the metadata document they need (show id or movie id). */
export function metadataIdFor(item: NetflixHistoryItem): number {
  return "series" in item && item.series !== undefined ? item.series : item.movieID;
}
