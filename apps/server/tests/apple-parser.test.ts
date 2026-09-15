import { describe, expect, it } from "vitest";
import { buildObservation, parseLabel, progressFromTrack } from "../src/providers/apple/parser";

const observedAt = new Date("2026-09-04T18:00:00Z");

describe("Apple label parsing", () => {
  it("splits comma-form show / episode / SxEy / minutes left", () => {
    expect(parseLabel("Cape Fear, Possum, S1, E6, 57 min left")).toEqual({
      showTitle: "Cape Fear",
      title: "Possum",
      seasonNumber: 1,
      episodeNumber: 6,
      minutesLeft: 57,
    });
  });

  it("handles episode titles containing commas", () => {
    expect(parseLabel("Dark Matter, A Quiet Life, S2, E1, 53 min left")).toEqual({
      showTitle: "Dark Matter",
      title: "A Quiet Life",
      seasonNumber: 2,
      episodeNumber: 1,
      minutesLeft: 53,
    });
  });

  it("treats a bare title as a movie title", () => {
    expect(parseLabel("Napoleon, 12 min left")).toEqual({
      title: "Napoleon",
      minutesLeft: 12,
    });
  });

  it("counts hours in remaining time", () => {
    expect(parseLabel("Silo, Farewell, S3, E9, 1 hr 2 min left")).toEqual({
      showTitle: "Silo",
      title: "Farewell",
      seasonNumber: 3,
      episodeNumber: 9,
      minutesLeft: 62,
    });
    expect(parseLabel("Napoleon, 1 hour left").minutesLeft).toBe(60);
  });
});

describe("Apple observation building", () => {
  it("builds a continue_watching episode with minutes-left as seconds remaining", () => {
    const obs = buildObservation(
      {
        id: "umc.cmc.40za8zmcwo8aaojlronma2jvo",
        routeType: "episode",
        label: "Cape Fear, Possum, S1, E6, 57 min left",
      },
      observedAt
    );
    expect(obs.provider).toBe("apple");
    expect(obs.source).toBe("continue_watching");
    expect(obs.mediaType).toBe("episode");
    expect(obs.showTitle).toBe("Cape Fear");
    expect(obs.title).toBe("Possum");
    expect(obs.seasonNumber).toBe(1);
    expect(obs.episodeNumber).toBe(6);
    expect(obs.progress).toBe(0); // no .progress-track = next episode, not started
    expect(obs.positionSeconds).toBe(57 * 60);
    expect(obs.watchedAt).toBeUndefined();
  });

  it("reads played percent from the progress-track fill", () => {
    const obs = buildObservation(
      {
        id: "umc.cmc.silo9",
        routeType: "episode",
        label: "Silo, Farewell, S3, E9, 1 hr 2 min left",
        trackStyle: "width: 42%",
      },
      observedAt
    );
    expect(obs.progress).toBe(42);
    expect(obs.episodeNumber).toBe(9);
    expect(obs.positionSeconds).toBe(62 * 60);
  });

  it("builds a movie", () => {
    const obs = buildObservation(
      { id: "umc.cmc.movie456", routeType: "movie", label: "Napoleon, 8 min left" },
      observedAt
    );
    expect(obs.mediaType).toBe("movie");
    expect(obs.title).toBe("Napoleon");
    expect(obs.showTitle).toBeUndefined();
    expect(obs.positionSeconds).toBe(8 * 60);
    expect(obs.progress).toBe(0);
  });
});

describe("Apple progress-track", () => {
  it("parses CSS width percent, scaleX, aria, and px ratio", () => {
    expect(progressFromTrack({ style: "width: 42%" })).toBe(42);
    expect(progressFromTrack({ style: "transform: scaleX(0.35)" })).toBe(35);
    expect(progressFromTrack({ ariaValueNow: "18" })).toBe(18);
    expect(progressFromTrack({ fillPx: 80, trackPx: 200 })).toBe(40);
    expect(progressFromTrack({})).toBeUndefined();
  });
});
