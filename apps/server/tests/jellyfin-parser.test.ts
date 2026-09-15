import { describe, expect, it } from "vitest";
import { parseJellyfinItem, ticksToSeconds } from "../src/providers/jellyfin/parser";

describe("ticksToSeconds", () => {
  it("converts Jellyfin ticks", () => {
    expect(ticksToSeconds(10_000_000)).toBe(1);
    expect(ticksToSeconds(0)).toBe(0);
    expect(ticksToSeconds(null)).toBeNull();
  });
});

describe("parseJellyfinItem", () => {
  const observedAt = new Date("2026-09-04T20:00:00Z");

  it("parses an in-progress episode", () => {
    const obs = parseJellyfinItem(
      {
        Id: "ep-1",
        Name: "Pilot",
        Type: "Episode",
        SeriesName: "The Bear",
        ParentIndexNumber: 1,
        IndexNumber: 1,
        RunTimeTicks: 30 * 60 * 10_000_000,
        UserData: {
          PlaybackPositionTicks: 10 * 60 * 10_000_000,
          PlayedPercentage: 33,
          Played: false,
          LastPlayedDate: "2026-09-04T18:00:00Z",
        },
      },
      observedAt,
      "user-1"
    );
    expect(obs).toMatchObject({
      provider: "jellyfin",
      providerContentId: "ep-1",
      mediaType: "episode",
      title: "Pilot",
      showTitle: "The Bear",
      seasonNumber: 1,
      episodeNumber: 1,
      progress: 33,
      source: "continue_watching",
    });
  });

  it("parses a played movie", () => {
    const obs = parseJellyfinItem(
      {
        Id: "mov-1",
        Name: "Dune",
        Type: "Movie",
        UserData: { Played: true, PlayedPercentage: 100, LastPlayedDate: "2026-08-01T12:00:00Z" },
      },
      observedAt,
      "user-1"
    );
    expect(obs?.mediaType).toBe("movie");
    expect(obs?.source).toBe("history");
    expect(obs?.showTitle).toBeUndefined();
  });

  it("skips unknown types and missing ids", () => {
    expect(parseJellyfinItem({ Type: "Folder", Id: "x" }, observedAt, "u")).toBeNull();
    expect(parseJellyfinItem({ Type: "Movie", Name: "Nope" }, observedAt, "u")).toBeNull();
  });
});
