/**
 * HBO Max (Max) modern web-API response shapes (WBD "beam"/discomax platform).
 *
 * The historic UTS HBO Max implementation (localStorage authToken + OAuth token
 * exchange + markers endpoint) no longer applies: the rebranded Max web client
 * stores no tokens in localStorage and serves a JSON:API content graph
 * authenticated purely by cookies + `disco_*` headers set by its own API client.
 * We therefore capture the app's own authenticated responses rather than calling
 * the endpoints ourselves. Only the umc-style episode/movie shaping intuition
 * carries over from UTS; the transport is entirely different.
 */

/** A JSON:API resource object (loosely typed — we read only what we need). */
export interface MaxResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: MaxRef | MaxRef[] }>;
}

export interface MaxRef {
  id: string;
  type: string;
}

/** `/cms/collections/{id}` document with an `included` graph. */
export interface MaxCollectionResponse {
  data: MaxResource;
  included?: MaxResource[];
}

/** `/users/me/profiles` document. */
export interface MaxProfilesResponse {
  data: {
    id: string;
    attributes: { profileName?: string; isDefault?: boolean };
  }[];
}

/** What we manage to capture from a Max home-page load. */
export interface MaxCapturedSession {
  profileName: string | null;
  /** The "Continue Watching" collection document, if it loaded. */
  continueWatching: MaxCollectionResponse | null;
}
