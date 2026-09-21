import { describe, expect, it } from "vitest";
import type { ObservationRow, SessionRow } from "../src/db/schema";
import { ADMIN_USER_ID } from "../src/db/schema";
import { discoveryPayload, pickLastWatched, statePayload } from "../src/hass/payload";

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 1,
    userId: ADMIN_USER_ID,
    provider: "netflix",
    profileId: null,
    providerContentId: "1",
    mediaType: "episode",
    title: "Fishes",
    showTitle: "The Bear",
    seasonNumber: 2,
    episodeNumber: 6,
    startedAt: new Date("2026-09-18T18:00:00Z"),
    endedAt: new Date("2026-09-18T18:40:00Z"),
    startProgress: 0,
    endProgress: 100,
    completed: true,
    observationCount: 1,
    updatedAt: new Date("2026-09-18T18:40:00Z"),
    ...over,
  };
}

describe("hass last watched", () => {
  it("prefers the latest session title", () => {
    const item = pickLastWatched([session()], []);
    expect(item?.title).toBe("The Bear · S2E6");
    expect(statePayload(item).body).toMatchObject({
      title: "The Bear · S2E6",
      provider: "netflix",
      season: 2,
      episode: 6,
    });
  });

  it("falls back to an observation", () => {
    const obs = {
      id: 1,
      fingerprint: "fp",
      userId: ADMIN_USER_ID,
      provider: "prime",
      profileId: null,
      providerContentId: "2",
      mediaType: "movie",
      title: "Dune",
      showTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      progress: 90,
      positionSeconds: null,
      durationSeconds: null,
      watchedAt: new Date("2026-09-17T12:00:00Z"),
      observedAt: new Date("2026-09-17T12:00:00Z"),
      source: "history",
      raw: {},
      parserVersion: "test",
    } satisfies ObservationRow;
    expect(pickLastWatched([], [obs])?.title).toBe("Dune");
  });

  it("builds MQTT discovery for a TV Tracker device", () => {
    const disc = discoveryPayload("homeassistant", "dev");
    expect(disc.topic).toBe("homeassistant/sensor/tv_tracker/last_watched/config");
    expect(disc.body).toMatchObject({
      name: "Last Watched",
      unique_id: "tv_tracker_last_watched",
      device: { name: "TV Tracker", identifiers: ["tv_tracker"] },
    });
  });
});
