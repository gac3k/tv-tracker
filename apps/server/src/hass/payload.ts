import { ADMIN_USER_ID, type ObservationRow, type SessionRow } from "../db/schema";

export interface LastWatched {
  title: string;
  showTitle: string | null;
  episodeTitle: string | null;
  provider: string;
  mediaType: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: string;
}

function episodeLabel(season: number | null, episode: number | null): string | null {
  if (season == null || episode == null) return null;
  return `S${season}E${episode}`;
}

function displayTitle(item: {
  title: string | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}): string {
  const heading = item.showTitle ?? item.title ?? "Untitled";
  const ep = episodeLabel(item.seasonNumber, item.episodeNumber);
  return ep ? `${heading} · ${ep}` : heading;
}

export function fromSession(row: SessionRow): LastWatched {
  return {
    title: displayTitle(row),
    showTitle: row.showTitle,
    episodeTitle: row.showTitle ? row.title : null,
    provider: row.provider,
    mediaType: row.mediaType,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    watchedAt: row.endedAt.toISOString(),
  };
}

export function fromObservation(row: ObservationRow): LastWatched {
  return {
    title: displayTitle(row),
    showTitle: row.showTitle,
    episodeTitle: row.showTitle ? row.title : null,
    provider: row.provider,
    mediaType: row.mediaType,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    watchedAt: (row.watchedAt ?? row.observedAt).toISOString(),
  };
}

export function pickLastWatched(sessions: SessionRow[], observations: ObservationRow[]): LastWatched | null {
  const session = sessions.find((row) => row.userId === ADMIN_USER_ID) ?? sessions[0];
  if (session) return fromSession(session);
  const obs = observations.find((row) => row.userId === ADMIN_USER_ID) ?? observations[0];
  return obs ? fromObservation(obs) : null;
}

export function discoveryPayload(prefix: string, version: string): {
  topic: string;
  body: Record<string, unknown>;
} {
  const node = "tv_tracker";
  const objectId = "last_watched";
  const stateTopic = `${node}/${objectId}`;
  return {
    topic: `${prefix}/sensor/${node}/${objectId}/config`,
    body: {
      name: "Last Watched",
      unique_id: `${node}_${objectId}`,
      object_id: `${node}_${objectId}`,
      state_topic: stateTopic,
      json_attributes_topic: stateTopic,
      value_template: "{{ value_json.title }}",
      icon: "mdi:television-play",
      device: {
        identifiers: [node],
        name: "TV Tracker",
        manufacturer: "vod-tracker",
        model: "vod-tracker",
        sw_version: version,
      },
      origin: { name: "vod-tracker", sw_version: version },
    },
  };
}

export function statePayload(item: LastWatched | null): {
  topic: string;
  body: Record<string, unknown>;
} {
  return {
    topic: "tv_tracker/last_watched",
    body: item
      ? {
          title: item.title,
          show_title: item.showTitle,
          episode_title: item.episodeTitle,
          provider: item.provider,
          media_type: item.mediaType,
          season: item.seasonNumber,
          episode: item.episodeNumber,
          watched_at: item.watchedAt,
        }
      : { title: "none" },
  };
}
