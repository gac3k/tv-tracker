import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client";
import {
  ObservationsService,
  observationFingerprint,
} from "../src/observations/observations.service";
import type { PlaybackObservation } from "../src/providers/provider";

function makeObservation(overrides: Partial<PlaybackObservation> = {}): PlaybackObservation {
  return {
    provider: "netflix",
    profileId: "profile-1",
    providerContentId: "81721305",
    mediaType: "episode",
    title: "Hotel Reverie",
    showTitle: "Black Mirror",
    seasonNumber: 7,
    episodeNumber: 3,
    progress: 92,
    watchedAt: new Date("2026-09-04T00:00:00Z"),
    observedAt: new Date("2026-09-04T16:00:00Z"),
    source: "history",
    raw: { movieID: 81721305 },
    ...overrides,
  };
}

describe("observation deduplication", () => {
  it("repeated identical polls insert only once", () => {
    const service = new ObservationsService(openDb(":memory:"));
    const obs = makeObservation();
    const first = service.insert([obs], "netflix-1");
    expect(first).toEqual({ inserted: 1, skipped: 0 });

    // Same data observed again later — same fingerprint, no new row.
    const later = makeObservation({ observedAt: new Date("2026-09-04T16:10:00Z") });
    const second = service.insert([later], "netflix-1");
    expect(second).toEqual({ inserted: 0, skipped: 1 });
    expect(service.list()).toHaveLength(1);
  });

  it("progress changes create separate observations", () => {
    const service = new ObservationsService(openDb(":memory:"));
    const steps = [12, 31, 55, 92].map((progress, i) =>
      makeObservation({ progress, observedAt: new Date(Date.UTC(2026, 8, 4, 16, i * 10)) })
    );
    const result = service.insert(steps, "netflix-1");
    expect(result.inserted).toBe(4);

    // Re-polling the final state does not duplicate.
    const again = service.insert([steps[3]!], "netflix-1");
    expect(again.inserted).toBe(0);
  });

  it("fingerprint depends on provider, profile, content, progress, position, watchedAt, source", () => {
    const base = makeObservation();
    expect(observationFingerprint(base)).toBe(observationFingerprint(makeObservation()));
    expect(observationFingerprint(makeObservation({ progress: 93 }))).not.toBe(
      observationFingerprint(base)
    );
    expect(observationFingerprint(makeObservation({ positionSeconds: 120 }))).not.toBe(
      observationFingerprint(base)
    );
    expect(observationFingerprint(makeObservation({ profileId: "other" }))).not.toBe(
      observationFingerprint(base)
    );
    expect(
      observationFingerprint(makeObservation({ watchedAt: new Date("2026-09-05T00:00:00Z") }))
    ).not.toBe(observationFingerprint(base));
  });
});
