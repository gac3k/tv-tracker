import { describe, expect, it } from "vitest";
import { episodesThrough, pickEpisodeId, pickSearchMatch } from "../src/plugins/justwatch/match";

const matrix = {
  id: "tm10",
  content: { title: "Matrix", originalReleaseYear: 1999, externalIds: { tmdbId: "603" } },
};
const sequel = {
  id: "tm11",
  content: { title: "Matrix Reaktywacja", originalReleaseYear: 2003, externalIds: { tmdbId: "604" } },
};

describe("pickSearchMatch", () => {
  it("prefers a TMDB id hit over title", () => {
    expect(pickSearchMatch([sequel, matrix], { title: "Nope", tmdbId: 603 })).toBe("tm10");
  });

  it("uses a unique title match when TMDB is missing", () => {
    expect(pickSearchMatch([matrix, sequel], { title: "Matrix" })).toBe("tm10");
  });

  it("returns null when two titles collide without a year", () => {
    const dup = { id: "tm99", content: { title: "Matrix", originalReleaseYear: 2021 } };
    expect(pickSearchMatch([matrix, dup], { title: "Matrix" })).toBeNull();
    expect(pickSearchMatch([matrix, dup], { title: "Matrix", year: 1999 })).toBe("tm10");
  });
});

const seasons = [
  {
    id: "tss0",
    content: { seasonNumber: 0 },
    episodes: [{ id: "tse-special", content: { episodeNumber: 1, seasonNumber: 0 } }],
  },
  {
    id: "tss1",
    content: { seasonNumber: 1 },
    episodes: [
      { id: "tse11", content: { episodeNumber: 1, seasonNumber: 1 } },
      { id: "tse12", content: { episodeNumber: 2, seasonNumber: 1 } },
      { id: "tse18", content: { episodeNumber: 8, seasonNumber: 1 } },
    ],
  },
  {
    id: "tss2",
    content: { seasonNumber: 2 },
    episodes: [
      { id: "tse21", content: { episodeNumber: 1, seasonNumber: 2 } },
      { id: "tse23", content: { episodeNumber: 3, seasonNumber: 2 } },
    ],
  },
];

describe("pickEpisodeId", () => {
  it("finds season/episode node ids", () => {
    expect(pickEpisodeId(seasons, 1, 2)).toBe("tse12");
    expect(pickEpisodeId(seasons, 3, 1)).toBeNull();
  });
});

describe("episodesThrough", () => {
  it("fills earlier episodes in the season and previous seasons", () => {
    expect(episodesThrough(seasons, 1, 8)).toEqual(["tse11", "tse12", "tse18"]);
    expect(episodesThrough(seasons, 2, 1)).toEqual(["tse11", "tse12", "tse18", "tse21"]);
  });

  it("skips specials unless the watched episode is a special", () => {
    expect(episodesThrough(seasons, 1, 1)).toEqual(["tse11"]);
    expect(episodesThrough(seasons, 0, 1)).toEqual(["tse-special"]);
  });
});
