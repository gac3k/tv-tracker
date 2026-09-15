/**
 * Parses Disney+ "Continue Watching" tiles scraped from the DOM into
 * PlaybackObservations.
 *
 * Disney+ (like Apple TV) exposes no account-side history API — UTS treats it
 * as a DOM scrobbler (src/services/disneyplus/DisneyplusParser.ts, MIT (c) 2020
 * trakt-tools); only the scraping approach carries over. Verified against the
 * live web app: each Continue Watching tile is a pair of anchors —
 * `a[data-testid="set-item"]` (uuid in data-item-id, localized aria-label) and
 * `a[data-testid="cw-set-item-metadata"]` whose child divs carry
 * "<n> m do końca" / show name / "S2:O22 Episode Title" (episode marker letter
 * is localized: O=odcinek in Polish, E in English — hence the loose regex).
 *
 * The shelf shows time-remaining, not a played-percentage, so observations
 * carry seconds-remaining in `positionSeconds` (same convention as Apple TV).
 */
import type { PlaybackObservation } from "../provider";

export const DISNEY_PARSER_VERSION = "disney-2";

/** One raw Continue Watching tile pair as scraped from disneyplus.com. */
export interface DisneyTileRaw {
  /** Playable content uuid from `data-item-id` / the /play/ href. */
  id: string;
  /** Text of the time-remaining div, e.g. "11 m do końca" / "1 h 5 m left". */
  remainingText?: string;
  /** Text of the show/title div, e.g. "Fineasz i Ferb". */
  showText?: string;
  /** Text of the episode line, e.g. "S2:O22 Ferie zimowe Fineasza i Ferba". */
  episodeText?: string;
  /** Localized aria-label of the tile (kept for raw/debugging). */
  ariaLabel?: string;
}

/** "S2:O22" / "S6:E11" — season digit(s), one localized letter, episode digit(s). */
const SEASON_EPISODE_REGEX = /\bS(?<season>\d+)\s*:\s*\p{Lu}(?<number>\d+)\b/u;

/** Sum hour/minute figures from localized remaining-time text. */
export function parseRemainingMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  let minutes = 0;
  let matched = false;
  const hours = /(\d+)\s*(?:h|godz)/i.exec(text);
  if (hours?.[1]) {
    minutes += Number(hours[1]) * 60;
    matched = true;
  }
  const mins = /(\d+)\s*m(?![a-z])/i.exec(text);
  if (mins?.[1]) {
    minutes += Number(mins[1]);
    matched = true;
  }
  return matched ? minutes : undefined;
}

export function buildObservation(raw: DisneyTileRaw, observedAt: Date): PlaybackObservation {
  const se = raw.episodeText ? SEASON_EPISODE_REGEX.exec(raw.episodeText) : null;
  const isEpisode = se?.groups != null;
  const minutesLeft = parseRemainingMinutes(raw.remainingText);

  let title: string | undefined;
  let showTitle: string | undefined;
  if (isEpisode) {
    showTitle = raw.showText?.trim() || undefined;
    title = raw.episodeText
      ?.replace(SEASON_EPISODE_REGEX, "")
      .replace(/^[\s·:–—-]+|[\s·:–—-]+$/g, "")
      .trim() || undefined;
  } else {
    // Movies have no episode line; the show div carries the movie title.
    title = (raw.showText ?? raw.episodeText)?.trim() || undefined;
  }

  return {
    provider: "disney",
    providerContentId: raw.id,
    mediaType: isEpisode ? "episode" : "movie",
    title,
    showTitle,
    seasonNumber: se?.groups ? Number(se.groups.season) : undefined,
    episodeNumber: se?.groups ? Number(se.groups.number) : undefined,
    // Seconds remaining in positionSeconds (no % on the shelf), same as Apple TV.
    positionSeconds: minutesLeft !== undefined ? minutesLeft * 60 : undefined,
    observedAt,
    source: "continue_watching",
    raw,
  };
}
