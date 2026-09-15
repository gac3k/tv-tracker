import { describe, expect, it } from "vitest";
import { parseContinueWatching } from "../src/providers/max/parser";
import { ProviderParseError } from "../src/providers/errors";
import type { MaxCollectionResponse } from "../src/providers/max/types";

const observedAt = new Date("2026-09-04T18:00:00Z");

// Minimal JSON:API graph mirroring the real Continue Watching shape.
const collection: MaxCollectionResponse = {
  data: {
    id: "cw",
    type: "collection",
    attributes: { alias: "home-page-rail-continue-watching" },
    relationships: {
      items: {
        data: [
          { id: "c:0", type: "collectionItem" },
          { id: "c:1", type: "collectionItem" },
        ],
      },
    },
  },
  included: [
    {
      id: "c:0",
      type: "collectionItem",
      relationships: { video: { data: { id: "ep-uuid", type: "video" } } },
    },
    {
      id: "c:1",
      type: "collectionItem",
      relationships: { video: { data: { id: "movie-uuid", type: "video" } } },
    },
    {
      id: "ep-uuid",
      type: "video",
      attributes: {
        videoType: "EPISODE",
        seasonNumber: 3,
        episodeNumber: 1,
        name: "Sól i morze",
        originalName: "Salt and Sea",
      },
      relationships: { show: { data: { id: "show-uuid", type: "show" } } },
    },
    {
      id: "show-uuid",
      type: "show",
      attributes: { name: "Ród Smoka", originalName: "House of the Dragon" },
    },
    {
      id: "movie-uuid",
      type: "video",
      attributes: { videoType: "MOVIE", name: "Diuna", originalName: "Dune" },
    },
  ],
};

describe("Max Continue Watching parser", () => {
  it("parses an episode with English titles and season/episode numbers", () => {
    const obs = parseContinueWatching(collection, observedAt);
    expect(obs).toHaveLength(2);
    const ep = obs[0]!;
    expect(ep.provider).toBe("max");
    expect(ep.source).toBe("continue_watching");
    expect(ep.mediaType).toBe("episode");
    expect(ep.showTitle).toBe("House of the Dragon");
    expect(ep.title).toBe("Salt and Sea");
    expect(ep.seasonNumber).toBe(3);
    expect(ep.episodeNumber).toBe(1);
    expect(ep.progress).toBeUndefined(); // no played-percentage in the payload
    expect(ep.providerContentId).toBe("ep-uuid");
  });

  it("parses a movie", () => {
    const movie = parseContinueWatching(collection, observedAt)[1]!;
    expect(movie.mediaType).toBe("movie");
    expect(movie.title).toBe("Dune");
    expect(movie.showTitle).toBeUndefined();
  });

  it("preserves rail order", () => {
    const obs = parseContinueWatching(collection, observedAt);
    expect(obs.map((o) => o.providerContentId)).toEqual(["ep-uuid", "movie-uuid"]);
  });

  it("throws clearly when the included graph is missing", () => {
    expect(() =>
      parseContinueWatching({ data: collection.data }, observedAt)
    ).toThrow(ProviderParseError);
  });
});
