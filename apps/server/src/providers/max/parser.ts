/**
 * Parses the Max "Continue Watching" JSON:API collection into
 * PlaybackObservations.
 *
 * The Continue Watching rail exposes which show/season/episode (or movie) is in
 * progress via structured `video`/`show` entities, but its `viewingHistory`
 * decorator only reports `{viewed}` — there is no played-percentage in this
 * payload. So observations are source "continue_watching" without a progress
 * value (mirrors Apple TV). English `originalName` is preferred for stable titles.
 */
import { ProviderParseError } from "../errors";
import type { PlaybackObservation } from "../provider";
import type { MaxCollectionResponse, MaxRef, MaxResource } from "./types";

export const MAX_PARSER_VERSION = "max-2";

function refOf(rel: { data?: MaxRef | MaxRef[] } | undefined): MaxRef | undefined {
  const data = rel?.data;
  if (!data) return undefined;
  return Array.isArray(data) ? data[0] : data;
}

/** Convert the captured Continue Watching collection into observations. */
export function parseContinueWatching(
  collection: MaxCollectionResponse,
  observedAt: Date
): PlaybackObservation[] {
  const included = collection.included;
  if (!Array.isArray(included)) {
    throw new ProviderParseError(
      "max",
      "Continue Watching collection has no `included` graph. Provider API may have changed."
    );
  }
  const byId = new Map<string, MaxResource>();
  for (const resource of included) {
    byId.set(`${resource.type}:${resource.id}`, resource);
  }

  const itemRefs = collection.data.relationships?.items?.data;
  const items = Array.isArray(itemRefs) ? itemRefs : [];
  const observations: PlaybackObservation[] = [];

  for (const itemRef of items) {
    const item = byId.get(`collectionItem:${itemRef.id}`);
    const videoRef = refOf(item?.relationships?.video);
    if (!videoRef) continue;
    const video = byId.get(`video:${videoRef.id}`);
    if (!video?.attributes) continue;

    const a = video.attributes;
    const videoType = String(a.videoType ?? a.materialType ?? "").toUpperCase();
    const isEpisode = videoType === "EPISODE";
    const title = (a.originalName ?? a.name) as string | undefined;

    let showTitle: string | undefined;
    let seasonNumber: number | undefined;
    let episodeNumber: number | undefined;
    if (isEpisode) {
      seasonNumber = typeof a.seasonNumber === "number" ? a.seasonNumber : undefined;
      episodeNumber = typeof a.episodeNumber === "number" ? a.episodeNumber : undefined;
      const showRef = refOf(video.relationships?.show);
      const show = showRef ? byId.get(`show:${showRef.id}`) : undefined;
      showTitle = (show?.attributes?.originalName ?? show?.attributes?.name) as string | undefined;
    }

    observations.push({
      provider: "max",
      providerContentId: video.id,
      mediaType: isEpisode ? "episode" : videoType === "MOVIE" || videoType === "FEATURE" ? "movie" : "unknown",
      title: title?.trim(),
      showTitle: showTitle?.trim(),
      seasonNumber,
      episodeNumber,
      // No played-percentage in the Continue Watching payload.
      observedAt,
      source: "continue_watching",
      raw: { video, item },
    });
  }

  return observations;
}
