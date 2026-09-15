import { describe, expect, it } from "vitest";
import {
  applyProgressMark,
  compactWatchKeys,
  parseTmdbWatchKey,
  watchedFromOverrides,
  type CatalogSeason,
} from "../src/shows/progress";

const catalog: CatalogSeason[] = [
  {
    season: 1,
    episodes: [
      { season: 1, episode: 1, airDate: "2024-01-01" },
      { season: 1, episode: 2, airDate: "2024-01-08" },
      { season: 1, episode: 3, airDate: "2024-01-15" },
    ],
  },
  {
    season: 2,
    episodes: [
      { season: 2, episode: 1, airDate: "2025-01-01" },
      { season: 2, episode: 2, airDate: "2026-10-01" },
    ],
  },
];

describe("show progress marks", () => {
  it("catch-up marks only episodes that have already aired", () => {
    const next = applyProgressMark(catalog, new Set(), { mark: "caught_up", today: "2026-09-14" });
    expect([...next].sort()).toEqual(["1:1", "1:2", "1:3", "2:1"]);
  });

  it("compacts a full season to one key and leftover episodes to episode keys", () => {
    const keys = compactWatchKeys(99, catalog, new Set(["1:1", "1:2", "1:3", "2:1"]));
    expect(keys).toEqual(["tmdb:tv:99:s1", "tmdb:tv:99:s2e1"]);
  });

  it("unmarking a season drops that season without clearing later episode marks", () => {
    const watched = applyProgressMark(catalog, new Set(["1:1", "1:2", "1:3", "2:1"]), {
      mark: "season",
      season: 1,
      on: false,
    });
    expect([...watched]).toEqual(["2:1"]);
  });

  it("reads season and episode override keys into a watched set", () => {
    const set = watchedFromOverrides(
      99,
      catalog,
      new Map([
        ["tmdb:tv:99:s1", "watched"],
        ["tmdb:tv:99:s2e1", "watched"],
      ])
    );
    expect(set.has("1:2")).toBe(true);
    expect(set.has("2:1")).toBe(true);
    expect(set.has("2:2")).toBe(false);
  });

  it("parses TMDB override keys", () => {
    expect(parseTmdbWatchKey("tmdb:tv:99:s2e3")).toEqual({
      kind: "tv-episode",
      tmdbId: 99,
      season: 2,
      episode: 3,
    });
    expect(parseTmdbWatchKey("tmdb:tv:99:s1")).toEqual({ kind: "tv-season", tmdbId: 99, season: 1 });
    expect(parseTmdbWatchKey("tmdb:movie:27205")).toEqual({ kind: "movie", tmdbId: 27205 });
    expect(parseTmdbWatchKey("netflix:abc")).toBeNull();
  });
});
