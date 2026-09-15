import { describe, expect, it } from "vitest";
import type { ObservationRow } from "../src/db/schema";
import { pickBestHit } from "../src/artwork/tmdb";
import {
  aggregateObservations,
  applyDerivedProgress,
  deriveProgress,
  groupByTitle,
  isContinueTitle,
  isInProgress,
  REMAINING_SECONDS_PROVIDERS,
} from "../src/library/aggregate";

let nextId = 1;
function row(overrides: Partial<ObservationRow>): ObservationRow {
  return {
    id: nextId++,
    fingerprint: `fp-${nextId}`,
    provider: "netflix",
    profileId: "p1",
    providerContentId: "100",
    mediaType: "episode",
    title: "Episode 4",
    showTitle: "Show",
    seasonNumber: 1,
    episodeNumber: 4,
    progress: null,
    positionSeconds: null,
    durationSeconds: null,
    watchedAt: null,
    observedAt: new Date("2026-09-04T16:00:00Z"),
    source: "history",
    raw: {},
    parserVersion: "test",
    ...overrides,
  };
}

describe("deriveProgress", () => {
  it("converts remaining time into a percentage", () => {
    // 11 min left of a 22 min episode = 50 %
    expect(deriveProgress(11 * 60, 22 * 60)).toBe(50);
  });

  it("clamps and rounds to two decimals", () => {
    expect(deriveProgress(0, 1800)).toBe(100);
    expect(deriveProgress(100, 300)).toBe(66.67);
  });

  it("refuses to derive when remaining exceeds the runtime", () => {
    // Mismatched numbers (wrong episode match, or a multi-episode block) —
    // reporting 0 % would be a confident lie.
    expect(deriveProgress(3600, 1800)).toBeNull();
  });

  it("returns null without a runtime", () => {
    expect(deriveProgress(600, null)).toBeNull();
    expect(deriveProgress(null, 1800)).toBeNull();
    expect(deriveProgress(600, 0)).toBeNull();
  });
});

describe("aggregateObservations", () => {
  it("collapses many observations of one item into a single card", () => {
    const items = aggregateObservations(
      [
        row({ progress: 12, observedAt: new Date("2026-09-04T16:00:00Z") }),
        row({ progress: 55, observedAt: new Date("2026-09-04T16:20:00Z") }),
        row({ progress: 94, observedAt: new Date("2026-09-04T16:47:00Z") }),
      ],
      85
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.progress).toBe(94);
    expect(items[0]!.progressSource).toBe("provider");
    expect(items[0]!.completed).toBe(true);
    expect(items[0]!.observationCount).toBe(3);
  });

  it("keeps the highest progress even if a rewatch reset it", () => {
    const items = aggregateObservations(
      [
        row({ progress: 90, observedAt: new Date("2026-09-04T10:00:00Z") }),
        row({ progress: 4, observedAt: new Date("2026-09-04T20:00:00Z") }),
      ],
      85
    );
    expect(items[0]!.progress).toBe(90);
    expect(items[0]!.completed).toBe(true);
  });

  it("carries the latest observation source through", () => {
    const [item] = aggregateObservations(
      [row({ provider: "max", source: "continue_watching" })],
      85
    );
    expect(item!.source).toBe("continue_watching");
  });

  it("separates content by provider and content id", () => {
    const items = aggregateObservations(
      [
        row({ provider: "netflix", providerContentId: "1" }),
        row({ provider: "prime", providerContentId: "1" }),
        row({ provider: "netflix", providerContentId: "2" }),
      ],
      85
    );
    expect(items).toHaveLength(3);
  });

  it("exposes remaining seconds only for remaining-time providers", () => {
    const [apple] = aggregateObservations(
      [row({ provider: "apple", positionSeconds: 660 })],
      85
    );
    const [disney] = aggregateObservations(
      [row({ provider: "disney", positionSeconds: 660 })],
      85
    );
    const [netflix] = aggregateObservations(
      [row({ provider: "netflix", positionSeconds: 660 })],
      85
    );
    expect(REMAINING_SECONDS_PROVIDERS.has("apple")).toBe(false);
    expect(REMAINING_SECONDS_PROVIDERS.has("disney")).toBe(true);
    expect(apple!.remainingSeconds).toBeNull();
    expect(disney!.remainingSeconds).toBe(660);
    // Netflix's positionSeconds is elapsed, not remaining — must not leak through.
    expect(netflix!.remainingSeconds).toBeNull();
  });

  it("marks earlier Apple episodes watched when a later one is on Continue Watching", () => {
    const items = aggregateObservations(
      [
        row({
          provider: "apple",
          providerContentId: "e8",
          showTitle: "Silo",
          title: "Gray Goo",
          seasonNumber: 3,
          episodeNumber: 8,
          source: "continue_watching",
          observedAt: new Date("2026-09-04T17:00:00Z"),
        }),
        row({
          provider: "apple",
          providerContentId: "e9",
          showTitle: "Silo",
          title: "Farewell",
          seasonNumber: 3,
          episodeNumber: 9,
          progress: 0,
          source: "continue_watching",
          observedAt: new Date("2026-09-11T07:00:00Z"),
        }),
      ],
      85
    );
    expect(items.find((i) => i.episodeNumber === 8)!.completed).toBe(true);
    expect(items.find((i) => i.episodeNumber === 9)!.completed).toBe(false);
    expect(groupByTitle(items)[0]!.latest.episodeNumber).toBe(9);
  });
});

describe("groupByTitle", () => {
  it("collapses six episodes of one show into a single card", () => {
    const items = aggregateObservations(
      [1, 2, 3, 4, 5, 6].map((n) =>
        row({
          providerContentId: `ep-${n}`,
          title: `Episode ${n}`,
          showTitle: "The Bear",
          episodeNumber: n,
          progress: n === 6 ? 40 : 95,
          observedAt: new Date(`2026-09-0${n}T12:00:00Z`),
        })
      ),
      85
    );
    const groups = groupByTitle(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.episodeCount).toBe(6);
    expect(groups[0]!.title).toBe("The Bear");
    expect(groups[0]!.latest.episodeNumber).toBe(6);
    expect(groups[0]!.lastWatched.toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });

  it("merges the same title across providers", () => {
    const items = aggregateObservations(
      [
        row({
          provider: "netflix",
          providerContentId: "n1",
          showTitle: "The Bear",
          progress: 30,
        }),
        row({
          provider: "max",
          providerContentId: "m1",
          showTitle: "The Bear",
          episodeNumber: 5,
          progress: 10,
        }),
      ],
      85
    );
    const groups = groupByTitle(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.providers.sort()).toEqual(["max", "netflix"]);
  });

  it("keeps different titles apart and prefers an in-progress episode", () => {
    const items = aggregateObservations(
      [
        row({
          providerContentId: "a",
          showTitle: "The Bear",
          episodeNumber: 4,
          progress: 95,
          observedAt: new Date("2026-09-04T18:00:00Z"),
        }),
        row({
          providerContentId: "b",
          showTitle: "The Bear",
          episodeNumber: 5,
          progress: 20,
          observedAt: new Date("2026-09-03T18:00:00Z"),
        }),
        row({
          providerContentId: "c",
          showTitle: "Shogun",
          mediaType: "episode",
          progress: 50,
        }),
      ],
      85
    );
    const groups = groupByTitle(items);
    expect(groups).toHaveLength(2);
    const bear = groups.find((g) => g.title === "The Bear")!;
    expect(bear.latest.episodeNumber).toBe(5);
    expect(bear.lastWatched.toISOString()).toBe("2026-09-04T18:00:00.000Z");
  });
});

describe("isContinueTitle", () => {
  it("keeps a finished series episode on the Continue shelf", () => {
    const [item] = aggregateObservations(
      [row({ showTitle: "1670", title: "Panna", progress: 87, episodeNumber: 6 })],
      85
    );
    expect(item!.completed).toBe(true);
    expect(isInProgress(item!)).toBe(false);
    expect(isContinueTitle(item!)).toBe(true);
  });

  it("drops a finished movie from Continue", () => {
    const [item] = aggregateObservations(
      [row({ mediaType: "movie", title: "A Film", showTitle: null, progress: 99 })],
      85
    );
    expect(item!.completed).toBe(true);
    expect(isContinueTitle(item!)).toBe(false);
  });
});

describe("applyDerivedProgress", () => {
  const [disneyItem] = aggregateObservations(
    [row({ provider: "disney", positionSeconds: 11 * 60, progress: null })],
    85
  );

  it("fills progress from a TMDB runtime", () => {
    const withProgress = applyDerivedProgress(disneyItem!, 22 * 60, 85);
    expect(withProgress.progress).toBe(50);
    expect(withProgress.progressSource).toBe("derived");
    expect(withProgress.completed).toBe(false);
  });

  it("marks completed when the derived value clears the threshold", () => {
    const item = { ...disneyItem!, remainingSeconds: 60 };
    expect(applyDerivedProgress(item, 30 * 60, 85).completed).toBe(true);
  });

  it("leaves provider-reported progress untouched", () => {
    const [netflixItem] = aggregateObservations([row({ progress: 42 })], 85);
    const result = applyDerivedProgress(netflixItem!, 3600, 85);
    expect(result.progress).toBe(42);
    expect(result.progressSource).toBe("provider");
  });

  it("stays null when no runtime is known", () => {
    const result = applyDerivedProgress(disneyItem!, null, 85);
    expect(result.progress).toBeNull();
    expect(result.progressSource).toBeNull();
  });
});

describe("TMDB result picking", () => {
  const hits = [
    { id: 1022789, title: "W głowie się nie mieści 2", original_title: "Inside Out 2" },
    { id: 150540, title: "W głowie się nie mieści", original_title: "Inside Out" },
  ];

  it("prefers an exact title match over TMDB's popularity order", () => {
    // Without this, querying the original film returns the sequel.
    expect(pickBestHit("W głowie się nie mieści", hits)?.id).toBe(150540);
    expect(pickBestHit("W głowie się nie mieści 2", hits)?.id).toBe(1022789);
  });

  it("matches on the original title too", () => {
    expect(pickBestHit("Inside Out", hits)?.id).toBe(150540);
  });

  it("falls back to the first result when nothing matches exactly", () => {
    expect(pickBestHit("something else", hits)?.id).toBe(1022789);
  });

  it("returns undefined for no results", () => {
    expect(pickBestHit("anything", [])).toBeUndefined();
  });
});
