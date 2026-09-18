import { describe, expect, it } from "vitest";
import type { ObservationRow } from "../src/db/schema";
import { inferSessions } from "../src/sessions/inference";

let nextId = 1;
function row(overrides: Partial<ObservationRow>): ObservationRow {
  return {
    id: nextId++,
    fingerprint: `fp-${nextId}`,
    userId: "admin",
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
    parserVersion: "netflix-1",
    ...overrides,
  };
}

const options = { gapMinutes: 60, watchedThresholdPercent: 85 };

describe("session inference", () => {
  it("merges close increasing observations into one session", () => {
    const observations = [
      row({ progress: 12, observedAt: new Date("2026-09-04T16:00:00Z") }),
      row({ progress: 31, observedAt: new Date("2026-09-04T16:10:00Z") }),
      row({ progress: 53, observedAt: new Date("2026-09-04T16:20:00Z") }),
      row({ progress: 94, observedAt: new Date("2026-09-04T16:47:00Z") }),
    ];
    const sessions = inferSessions(observations, options);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.startProgress).toBe(12);
    expect(sessions[0]!.endProgress).toBe(94);
    expect(sessions[0]!.completed).toBe(true);
    expect(sessions[0]!.observationCount).toBe(4);
  });

  it("splits sessions on a large time gap", () => {
    const observations = [
      row({ progress: 20, observedAt: new Date("2026-09-04T10:00:00Z") }),
      row({ progress: 40, observedAt: new Date("2026-09-04T16:00:00Z") }),
    ];
    const sessions = inferSessions(observations, options);
    expect(sessions).toHaveLength(2);
  });

  it("splits on a big progress drop (rewatch)", () => {
    const observations = [
      row({ progress: 90, observedAt: new Date("2026-09-04T16:00:00Z") }),
      row({ progress: 5, observedAt: new Date("2026-09-04T16:30:00Z") }),
    ];
    const sessions = inferSessions(observations, options);
    expect(sessions).toHaveLength(2);
  });

  it("respects the completion threshold", () => {
    const observations = [row({ progress: 84 })];
    expect(inferSessions(observations, options)[0]!.completed).toBe(false);
    expect(
      inferSessions(observations, { ...options, watchedThresholdPercent: 80 })[0]!.completed
    ).toBe(true);
  });

  it("keeps different content/profiles in separate sessions", () => {
    const observations = [
      row({ providerContentId: "100", progress: 10 }),
      row({ providerContentId: "200", progress: 20 }),
      row({ providerContentId: "100", profileId: "p2", progress: 30 }),
    ];
    expect(inferSessions(observations, options)).toHaveLength(3);
  });
});
