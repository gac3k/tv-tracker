import { describe, expect, it } from "vitest";
import type { ContinueSource } from "../src/library/suggest";
import { isShelfHold, pickContinue, pickWatch } from "../src/library/suggest";

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

  it("skips shelf holds", () => {
    const held = item({
      key: "h",
      provider: "apple",
      showTitle: "Severance",
      seasonNumber: 2,
      episodeNumber: 1,
      progress: 0,
      source: "continue_watching",
      shelfHold: true,
    });
    expect(pickContinue([held], 5)).toEqual([]);
  });
});

describe("isShelfHold", () => {
  const apple = {
    provider: "apple",
    mediaType: "episode",
    seasonNumber: 2,
    episodeNumber: 1,
    progress: 0,
    lastAiredSeason: 1,
    lastAiredEpisode: 8,
  };

  it("holds an unaired next-season premiere", () => {
    expect(isShelfHold(apple)).toBe(true);
    expect(isShelfHold({ ...apple, provider: "max", progress: null })).toBe(true);
    expect(isShelfHold({ ...apple, provider: "disney", seasonNumber: 3, lastAiredSeason: 2, lastAiredEpisode: 10 })).toBe(true);
  });

  it("keeps the premiere once it has aired, and a real in-progress bar", () => {
    expect(isShelfHold({ ...apple, lastAiredSeason: 2, lastAiredEpisode: 1 })).toBe(false);
    expect(isShelfHold({ ...apple, progress: 15 })).toBe(false);
  });

  it("holds an untouched pilot under 2%", () => {
    expect(isShelfHold({ ...apple, seasonNumber: 1, episodeNumber: 1, progress: 1.5, lastAiredSeason: null, lastAiredEpisode: null })).toBe(true);
    expect(isShelfHold({ ...apple, seasonNumber: 1, episodeNumber: 1, progress: 2 })).toBe(false);
    expect(isShelfHold({ ...apple, seasonNumber: 1, episodeNumber: 1, progress: null })).toBe(false);
  });

  it("leaves history providers and mid-season gaps alone", () => {
    expect(isShelfHold({ ...apple, provider: "netflix" })).toBe(false);
    expect(isShelfHold({ ...apple, episodeNumber: 6, seasonNumber: 1, lastAiredSeason: 1, lastAiredEpisode: 5 })).toBe(false);
    expect(isShelfHold({ ...apple, mediaType: "movie" })).toBe(false);
    expect(isShelfHold({ ...apple, lastAiredSeason: null, lastAiredEpisode: null })).toBe(false);
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
