/**
 * Prime Video private-API response shapes.
 *
 * Derived from Universal Trakt Scrobbler (https://github.com/trakt-tools/universal-trakt-scrobbler)
 * src/services/amazon-prime/AmazonPrimeApi.ts — MIT License, Copyright (c) 2020 trakt-tools.
 * See NOTICE for full attribution.
 */

export interface PrimeConfigResponse {
  customerConfig: {
    homeRegion: string;
  };
  territoryConfig: {
    defaultVideoWebsite: string;
  };
}

export interface PrimeProfileResponse {
  profiles: {
    id: string;
    isSelected: boolean;
    name: string;
  }[];
}

export interface PrimeHistoryResponseItem {
  /** Global title identifier, e.g. "amzn1.dv.gti.xxxx". */
  gti: string;
  /** Watch time, epoch milliseconds. */
  time: number;
  /** Episodes are nested under their show entry. */
  children: PrimeHistoryResponseItem[];
}

export interface PrimeHistoryResponse {
  widgets: {
    content: {
      content:
        | {
            nextToken?: string;
            titles: {
              /** Format: "April 11, 2020" */
              date: string;
              titles: PrimeHistoryResponseItem[];
            }[];
          }
        | {
            header: string;
            message: string;
          };
    };
    /** The history widget has type "watch-history". */
    widgetType: string;
  }[];
}

export interface PrimeEnrichmentsResponse {
  enrichments: Partial<
    Record<
      string,
      {
        progress?: {
          percentage: number;
        };
      }
    >
  >;
}

export interface PrimeMetadataItem {
  catalogMetadata?: {
    catalog: {
      entityType: "TV Show" | "Movie" | "Trailer" | "Bonus Content";
      episodeNumber?: number;
      id: string;
      title: string;
    };
    family?: {
      tvAncestors: [
        { catalog: { seasonNumber: number } },
        { catalog: { title: string } },
      ];
    };
  };
}
