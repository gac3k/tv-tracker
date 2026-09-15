/**
 * Parses Apple TV "Continue Watching" lockups scraped from the DOM into
 * PlaybackObservations.
 *
 * URL/route shapes (umc.cmc content ids, /movie|/episode|/show paths) and the
 * "SxEy" recognition are derived from Universal Trakt Scrobbler
 * src/services/apple-tv/AppleTvParser.ts (MIT License, Copyright (c) 2020
 * trakt-tools). See NOTICE.
 *
 * Note: Apple TV exposes no account-side viewing-history API (UTS marks the
 * service hasSync:false). The Continue Watching shelf is the *next* episode
 * (or in-progress one): E9 on the shelf means E8 was finished. Played-% comes
 * from `.progress-track` when the tile has a bar; no bar means not started.
 * The label still carries "NN min left", kept in `positionSeconds` as remaining
 * time, not as a progress source.
 */
import type { PlaybackObservation } from "../provider";

export const APPLE_PARSER_VERSION = "apple-3";

/** One raw Continue Watching lockup as scraped from the page. */
export interface AppleUpNextRaw {
  /** Content id (umc.cmc.*) parsed from the href. */
  id: string;
  /** "movie" | "episode" | "show" from the URL path. */
  routeType: string;
  /** Accessible label, e.g. "Cape Fear, Possum, S1, E6, 57 min left". */
  label: string;
  /** Inline style of the progress fill, when `.progress-track` exists. */
  trackStyle?: string;
  trackAria?: string;
  fillPx?: number;
  trackPx?: number;
}

const SEASON_EPISODE_REGEX = /\bS(?<season>\d+)\s*[,·]?\s*E(?<number>\d+)\b/i;
const REMAINING_TAIL_REGEX = /,?\s*(?:\d+\s*h(?:ou)?rs?\s*)?(?:\d+\s*min(?:ute)?s?\s*)?left.*$/i;

export interface ParsedLabel {
  showTitle?: string;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  minutesLeft?: number;
}

function clampPercent(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

/** Played % from a `.progress-track` fill (`width: 42%`, `scaleX(0.42)`, aria, or px ratio). */
export function progressFromTrack(raw: {
  style?: string | null;
  ariaValueNow?: string | null;
  fillPx?: number;
  trackPx?: number;
}): number | undefined {
  if (raw.ariaValueNow != null && raw.ariaValueNow !== "") {
    const aria = Number(raw.ariaValueNow);
    if (Number.isFinite(aria)) return clampPercent(aria);
  }
  const style = raw.style ?? "";
  const widthPct = /width:\s*([\d.]+)%/i.exec(style);
  if (widthPct) return clampPercent(Number(widthPct[1]));
  const scale = /scaleX\(\s*([\d.]+)\s*\)/i.exec(style);
  if (scale) {
    const n = Number(scale[1]);
    return clampPercent(n <= 1 ? n * 100 : n);
  }
  if (typeof raw.fillPx === "number" && typeof raw.trackPx === "number" && raw.trackPx > 0) {
    return clampPercent((raw.fillPx / raw.trackPx) * 100);
  }
  return undefined;
}

/** "57 min left" / "1 hr 2 min left" / "1 hour left". */
export function parseRemainingMinutes(label: string): number | undefined {
  const hours = /(\d+)\s*h(?:ou)?rs?/i.exec(label);
  const mins = /(\d+)\s*min(?:ute)?s?/i.exec(label);
  if (!hours && !mins) return undefined;
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

/**
 * Parse an Apple accessible label. Episode form is comma-separated:
 * "<Show>, <Episode>, S<n>, E<n>, <NN> min left" (or "N hr NN min left").
 * Movie form is "<Title>, <NN> min left" (or just "<Title>").
 */
export function parseLabel(label: string): ParsedLabel {
  const minutesLeft = parseRemainingMinutes(label);

  // Drop the "NN min left" / "N hr NN min left" tail (and anything after it).
  const cleaned = label.replace(REMAINING_TAIL_REGEX, "").trim();

  const se = SEASON_EPISODE_REGEX.exec(cleaned);
  if (se?.groups && se.index !== undefined) {
    const head = cleaned.slice(0, se.index).replace(/[\s,·]+$/, "");
    const parts = head.split(/,\s*/).filter(Boolean);
    const showTitle = parts[0]?.trim() || undefined;
    const title = parts.slice(1).join(", ").trim() || undefined;
    return {
      showTitle,
      title,
      seasonNumber: Number(se.groups.season),
      episodeNumber: Number(se.groups.number),
      minutesLeft,
    };
  }

  return { title: cleaned || undefined, minutesLeft };
}

export function buildObservation(raw: AppleUpNextRaw, observedAt: Date): PlaybackObservation {
  const parts = parseLabel(raw.label);
  const isEpisode = raw.routeType === "episode" || parts.seasonNumber !== undefined;
  // No bar = next episode, not started. Don't fall back to minutes-left vs TMDB.
  const progress =
    progressFromTrack({
      style: raw.trackStyle,
      ariaValueNow: raw.trackAria,
      fillPx: raw.fillPx,
      trackPx: raw.trackPx,
    }) ?? 0;

  return {
    provider: "apple",
    providerContentId: raw.id,
    mediaType: isEpisode ? "episode" : raw.routeType === "movie" ? "movie" : "unknown",
    title: parts.title,
    showTitle: parts.showTitle,
    seasonNumber: parts.seasonNumber,
    episodeNumber: parts.episodeNumber,
    progress,
    positionSeconds: parts.minutesLeft !== undefined ? parts.minutesLeft * 60 : undefined,
    observedAt,
    source: "continue_watching",
    raw: { ...raw, minutesLeft: parts.minutesLeft, progress },
  };
}
