import { describe, expect, it } from "vitest";
import type { ContinueSource } from "../src/library/suggest";
import { pickContinue, pickWatch } from "../src/library/suggest";

function item(over: Partial<ContinueSource> & Pick<ContinueSource, "key">): ContinueSource {
  return {
    provider: "netflix",
    providerContentId: over.key,
    mediaType: "episode",
    title: "E4",
    showTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 4,
    progress: null,
    progressSource: null,
    remainingSeconds: null,
    completed: false,
    source: "history",
    watchedAt: null,
    observedAt: new Date("2026-09-18T12:00:00Z"),
    observationCount: 1,
    ...over,
  };
}

describe("pickContinue", () => {
  it("returns in-progress titles before Watch Next", () => {
    const mid = item({ key: "a", showTitle: "The Bear", progress: 40, source: "continue_watching" });
    const done = item({
      key: "b",
      showTitle: "Severance",
      completed: true,
      progress: 96,
      lastAiredSeason: 1,
      lastAiredEpisode: 8,
    });
    const picks = pickContinue([mid, done], 5);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ title: "The Bear", reason: "in_progress" });
  });

  it("falls back to Watch Next when nothing is mid-watch", () => {
    const done = item({
      key: "b",
      showTitle: "Severance",
      completed: true,
      progress: 96,
      episodeNumber: 4,
      lastAiredSeason: 1,
      lastAiredEpisode: 8,
    });
    const picks = pickContinue([done], 5);
    expect(picks[0]).toMatchObject({ title: "Severance", reason: "watch_next", episodeNumber: 5 });
  });

  it("hides caught-up series from Watch Next", () => {
    const caught = item({
      key: "c",
      showTitle: "The Bear",
      completed: true,
      progress: 96,
      seasonNumber: 2,
      episodeNumber: 4,
      lastAiredSeason: 2,
      lastAiredEpisode: 4,
    });
    expect(pickContinue([caught], 5)).toEqual([]);
  });
});

describe("pickWatch", () => {
  it("prefers the watchlist over unwatched library titles", () => {
    const picks = pickWatch(
      [{ title: "Dune", tmdbType: "movie" }],
      [item({ key: "u", mediaType: "movie", title: "Heat", showTitle: null })],
      undefined,
      5
    );
    expect(picks.map((p) => p.title)).toEqual(["Dune", "Heat"]);
    expect(picks[0]?.reason).toBe("watchlist");
  });

  it("filters by kind", () => {
    const picks = pickWatch(
      [
        { title: "Dune", tmdbType: "movie" },
        { title: "The Bear", tmdbType: "tv" },
      ],
      [],
      "movie",
      5
    );
    expect(picks).toEqual([
      expect.objectContaining({ title: "Dune", kind: "movie" }),
    ]);
  });
});
