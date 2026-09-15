import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calculateProgress,
  matchEpisodeMetadata,
  parseHistoryItem,
} from "../src/providers/netflix/parser";
import { ProviderParseError } from "../src/providers/errors";
import type { NetflixSingleMetadataItem } from "../src/providers/netflix/types";

const showMetadata = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/netflix-metadata-show.json"), "utf8")
) as NetflixSingleMetadataItem;

const observedAt = new Date("2026-09-04T16:00:00Z");

const episodeHistoryItem = {
  date: 1756944000000,
  episodeTitle: "Hotel Reverie",
  movieID: 81721305,
  series: 70264888,
  seriesTitle: "Black Mirror",
  title: 'Black Mirror: Season 7: "Hotel Reverie"',
  bookmark: 3210,
  duration: 3420,
};

describe("Netflix history parser", () => {
  it("parses an episode with metadata (season/episode numbers)", () => {
    const obs = parseHistoryItem(episodeHistoryItem, showMetadata, observedAt);
    expect(obs.provider).toBe("netflix");
    expect(obs.mediaType).toBe("episode");
    expect(obs.showTitle).toBe("Black Mirror");
    expect(obs.title).toBe("Hotel Reverie");
    expect(obs.seasonNumber).toBe(7);
    expect(obs.episodeNumber).toBe(3);
    expect(obs.providerContentId).toBe("81721305");
    expect(obs.watchedAt).toEqual(new Date(1756944000000));
    expect(obs.raw).toBe(episodeHistoryItem);
  });

  it("parses an episode without metadata (falls back to history fields)", () => {
    const obs = parseHistoryItem(episodeHistoryItem, null, observedAt);
    expect(obs.mediaType).toBe("episode");
    expect(obs.seasonNumber).toBeUndefined();
    expect(obs.showTitle).toBe("Black Mirror");
  });

  it("parses a movie", () => {
    const obs = parseHistoryItem(
      { date: 1756944000000, movieID: 123, title: "The Movie", bookmark: 90, duration: 100 },
      null,
      observedAt
    );
    expect(obs.mediaType).toBe("movie");
    expect(obs.title).toBe("The Movie");
    expect(obs.showTitle).toBeUndefined();
    expect(obs.progress).toBe(90);
  });

  it("calculates progress from bookmark/duration", () => {
    const obs = parseHistoryItem(episodeHistoryItem, showMetadata, observedAt);
    // 3210 / 3420 = 93.859% floored to 2 decimals
    expect(obs.progress).toBe(93.85);
    expect(obs.positionSeconds).toBe(3210);
    expect(obs.durationSeconds).toBe(3420);
  });

  it("hides season/episode numbers for collections (hiddenEpisodeNumbers)", () => {
    const collection = structuredClone(showMetadata);
    collection.video.hiddenEpisodeNumbers = true;
    const match = matchEpisodeMetadata(collection, 81721305);
    expect(match?.seasonNumber).toBeUndefined();
    expect(match?.showTitle).toBe("Black Mirror");
  });

  it("fails clearly on an unknown payload", () => {
    expect(() => parseHistoryItem({ foo: "bar" }, null, observedAt)).toThrow(ProviderParseError);
    expect(() => parseHistoryItem({ foo: "bar" }, null, observedAt)).toThrow(/API may have changed/);
  });
});

describe("calculateProgress", () => {
  it("clamps and floors to 2 decimals", () => {
    expect(calculateProgress(50, 100)).toBe(50);
    expect(calculateProgress(1, 3)).toBe(33.33);
    expect(calculateProgress(200, 100)).toBe(100);
    expect(calculateProgress(-5, 100)).toBe(0);
  });

  it("returns undefined for missing/invalid values", () => {
    expect(calculateProgress(undefined, 100)).toBeUndefined();
    expect(calculateProgress(50, 0)).toBeUndefined();
    expect(calculateProgress(50, undefined)).toBeUndefined();
    expect(calculateProgress(NaN, 100)).toBeUndefined();
  });
});
