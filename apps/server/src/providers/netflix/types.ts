/**
 * Netflix private-API response shapes.
 *
 * Derived from Universal Trakt Scrobbler (https://github.com/trakt-tools/universal-trakt-scrobbler)
 * src/services/netflix/NetflixApi.ts — MIT License, Copyright (c) 2020 trakt-tools.
 * See NOTICE for full attribution.
 */

export interface NetflixSession {
  authUrl: string;
  profileName: string | null;
  userGuid?: string;
  buildIdentifier?: string;
}

export interface NetflixHistoryProgress {
  /** Playback position in seconds. */
  bookmark?: number;
  /** Runtime in seconds. */
  duration?: number;
}

export interface NetflixHistoryEpisodeItem extends NetflixHistoryProgress {
  /** Watch date, epoch milliseconds (day precision). */
  date: number;
  episodeTitle: string;
  /** Netflix video id of the episode. */
  movieID: number;
  /** Netflix video id of the show. */
  series: number;
  seriesTitle: string;
  title: string;
}

export interface NetflixHistoryMovieItem extends NetflixHistoryProgress {
  date: number;
  movieID: number;
  title: string;
}

export type NetflixHistoryItem = NetflixHistoryEpisodeItem | NetflixHistoryMovieItem;

export interface NetflixAuiHistoryResponse {
  jsonGraph: {
    aui: {
      viewingActivity?: {
        value?: { viewedItems?: NetflixHistoryItem[] };
      };
    };
  };
}

export interface NetflixMetadataShowEpisode {
  id: number;
  seq: number;
  title: string;
  bookmark?: { offset?: number | null } | null;
  runtime?: number | null;
}

export interface NetflixMetadataShowSeason {
  episodes: NetflixMetadataShowEpisode[];
  seq: number;
}

export interface NetflixMetadataVideo {
  type: "show" | "movie";
  id: number;
  title: string;
  year: number;
  bookmark?: { offset?: number | null } | null;
  runtime?: number | null;
  /** true for "collections" whose numbering is not canonical. */
  hiddenEpisodeNumbers?: boolean;
  seasons?: NetflixMetadataShowSeason[];
}

export interface NetflixSingleMetadataItem {
  video: NetflixMetadataVideo;
}
