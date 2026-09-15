import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client";
import { exportMarks } from "../src/db/schema";
import { JobsService, planSyncTargets } from "../src/jobs/jobs.service";
import type { PluginRegistry } from "../src/plugins/registry.service";
import type { ProviderRegistry } from "../src/providers/registry.service";
import type { PlaybackObservation } from "../src/providers/provider";
import type { SyncService } from "../src/sync/sync.service";
import { countBy, sampleObservations } from "../src/sync/sync.service";

function jobsService(): JobsService {
  return new JobsService(openDb(":memory:"), {} as SyncService, {} as ProviderRegistry, {} as PluginRegistry);
}

describe("job run log", () => {
  it("stores debug lines against a run", () => {
    const jobs = jobsService();
    const run = jobs.begin({ trigger: "manual", provider: "netflix" });
    jobs.append(run.id, "info", "fetched observations", { count: 2, cookie: "abc" });
    jobs.finish(run.id, {
      status: "success",
      summary: { results: [{ provider: "netflix", status: "success", fetched: 2 }] },
    });

    const listed = jobs.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("success");
    expect(listed[0]?.provider).toBe("netflix");

    const detail = jobs.get(run.id);
    expect(detail?.logs).toHaveLength(1);
    expect(detail?.logs[0]?.message).toBe("fetched observations");
    expect(detail?.logs[0]?.data).toEqual({ count: 2, cookie: "[REDACTED]" });
  });

  it("keeps the newest 200 runs", () => {
    const jobs = jobsService();
    for (let i = 0; i < 201; i++) {
      jobs.begin({ trigger: "schedule", provider: "netflix" });
    }
    const listed = jobs.list(300);
    expect(listed).toHaveLength(200);
    expect(listed[0]?.id).toBeGreaterThan(listed[199]?.id ?? 0);
  });
});

describe("sync debug summaries", () => {
  const items: PlaybackObservation[] = [
    {
      provider: "netflix",
      providerContentId: "1",
      mediaType: "episode",
      title: "Pilot",
      showTitle: "Show",
      source: "history",
      observedAt: new Date("2026-09-07T12:00:00Z"),
      raw: {},
    },
    {
      provider: "netflix",
      providerContentId: "2",
      mediaType: "movie",
      title: "Film",
      source: "continue_watching",
      observedAt: new Date("2026-09-07T12:01:00Z"),
      raw: {},
    },
  ];

  it("counts by type and source", () => {
    expect(countBy(items, "mediaType")).toEqual({ episode: 1, movie: 1 });
    expect(countBy(items, "source")).toEqual({ history: 1, continue_watching: 1 });
  });

  it("samples titles without raw payloads", () => {
    const sample = sampleObservations(items, 1);
    expect(sample).toEqual([
      {
        id: "1",
        type: "episode",
        title: "Show · Pilot",
        season: null,
        episode: null,
        progress: null,
        source: "history",
        watchedAt: null,
      },
    ]);
    expect(sample[0]).not.toHaveProperty("raw");
  });
});

describe("planSyncTargets", () => {
  const entries = [
    { id: "netflix", enabled: true },
    { id: "jellyfin", enabled: false },
  ];

  it("runs enabled sources", () => {
    expect(planSyncTargets(undefined, entries)).toEqual(["netflix"]);
  });

  it("runs a named source even when disabled", () => {
    expect(planSyncTargets("jellyfin", entries)).toEqual(["jellyfin"]);
  });

  it("runs a named unknown source so the job can record the error", () => {
    expect(planSyncTargets("missing", entries)).toEqual(["missing"]);
  });
});

describe("export marks", () => {
  it("upserts by sink and content key", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-07T12:00:00Z");
    db.insert(exportMarks)
      .values({ sink: "justwatch", contentKey: "netflix:1", remoteId: "tm1", exportedAt: now })
      .run();
    db.insert(exportMarks)
      .values({ sink: "justwatch", contentKey: "netflix:1", remoteId: "tm2", exportedAt: now })
      .onConflictDoUpdate({
        target: [exportMarks.sink, exportMarks.contentKey],
        set: { remoteId: "tm2" },
      })
      .run();
    const rows = db.select().from(exportMarks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.remoteId).toBe("tm2");
  });
});
