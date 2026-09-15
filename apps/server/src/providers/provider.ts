/** Registered via `@ContentProvider`. New adapters add a string id, not a union member. */
export type ProviderName = string;

export type MediaType = "movie" | "episode" | "unknown";

export type ObservationSource = "history" | "continue_watching" | "live" | "unknown";

/** A single normalized data point about playback, as retrieved from a provider. */
export interface PlaybackObservation {
  provider: ProviderName;
  profileId?: string;
  providerContentId: string;
  mediaType: MediaType;
  title?: string;
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  /** 0-100, undefined when the provider did not expose position/duration. */
  progress?: number;
  positionSeconds?: number;
  durationSeconds?: number;
  /** Provider-reported watch time (Netflix only exposes day precision). */
  watchedAt?: Date;
  /** When we retrieved this data point. */
  observedAt: Date;
  source: ObservationSource;
  /** Original provider payload, always persisted for future re-parsing. */
  raw: unknown;
}

export interface SyncOptions {
  /** How many history pages to fetch (provider-specific page size). */
  pages?: number;
  /** Save a sanitized copy of raw provider responses for debugging. */
  saveFixture?: boolean;
}

export interface ProviderStatus {
  authenticated: boolean;
  profileName?: string;
}

export interface ProviderSettings {
  enabled: boolean;
  includeData: boolean;
  values: Record<string, string>;
}

export interface VodProvider {
  readonly name: ProviderName;
  /** Cheap check that the persisted browser session is still logged in. */
  isAuthenticated(): Promise<ProviderStatus>;
  /** Fetch and normalize current data from the provider. Does not persist. */
  sync(options?: SyncOptions): Promise<PlaybackObservation[]>;
  /** Interactive login in a visible browser. Resolves when the user is done. */
  login(): Promise<void>;
  /** Push UI-saved settings before sync / auth checks. Optional for browser-only adapters. */
  applySettings?(settings: ProviderSettings): void;
}
