import type { MediaType, ObservationSource, PlaybackObservation } from "../provider";

export const JELLYFIN_PARSER_VERSION = "jellyfin-1";

const TICKS_PER_SECOND = 10_000_000;

export interface JellyfinUserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  LastPlayedDate?: string;
}

export interface JellyfinItem {
  Id?: string;
  Name?: string;
  Type?: string;
  SeriesName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  RunTimeTicks?: number;
  UserData?: JellyfinUserData;
}

export function ticksToSeconds(ticks: number | null | undefined): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / TICKS_PER_SECOND;
}

function mediaTypeOf(type: string | undefined): MediaType {
  if (type === "Movie") return "movie";
  if (type === "Episode") return "episode";
  return "unknown";
}

function sourceOf(userData: JellyfinUserData | undefined, progress: number | null): ObservationSource {
  if (userData?.Played) return "history";
  if ((progress ?? 0) > 0 || (userData?.PlaybackPositionTicks ?? 0) > 0) return "continue_watching";
  return "history";
}

export function parseJellyfinItem(
  item: JellyfinItem,
  observedAt: Date,
  profileId: string
): PlaybackObservation | null {
  if (!item.Id) return null;
  const mediaType = mediaTypeOf(item.Type);
  if (mediaType === "unknown") return null;

  const positionSeconds = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const durationSeconds = ticksToSeconds(item.RunTimeTicks);
  let progress: number | undefined;
  if (typeof item.UserData?.PlayedPercentage === "number") {
    progress = item.UserData.PlayedPercentage;
  } else if (positionSeconds != null && durationSeconds && durationSeconds > 0) {
    progress = (positionSeconds / durationSeconds) * 100;
  }

  const watchedAt = item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate) : undefined;

  return {
    provider: "jellyfin",
    profileId,
    providerContentId: item.Id,
    mediaType,
    title: item.Name,
    showTitle: mediaType === "episode" ? item.SeriesName : undefined,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    progress,
    positionSeconds: positionSeconds ?? undefined,
    durationSeconds: durationSeconds ?? undefined,
    watchedAt: watchedAt && !Number.isNaN(watchedAt.getTime()) ? watchedAt : undefined,
    observedAt,
    source: sourceOf(item.UserData, progress ?? null),
    raw: item,
  };
}
