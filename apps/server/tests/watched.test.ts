import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client";
import { exportMarks, libraryOverrides, tmdbDetails, watchlist } from "../src/db/schema";
import { pendingWatched } from "../src/plugins/watched";

describe("pending watched export", () => {
  it("includes TMDB episode marks that were never observed", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-14T12:00:00Z");
    db.insert(watchlist)
      .values({ tmdbType: "tv", tmdbId: 99, title: "Silo", posterPath: null, addedAt: now })
      .run();
    db.insert(libraryOverrides)
      .values({ key: "tmdb:tv:99:s2e1", action: "watched", updatedAt: now })
      .run();

    expect(pendingWatched(db, "justwatch")).toEqual([
      expect.objectContaining({
        key: "tmdb:tv:99:s2e1",
        mediaType: "episode",
        showTitle: "Silo",
        seasonNumber: 2,
        episodeNumber: 1,
        tmdbId: 99,
      }),
    ]);
  });

  it("expands a season key to the last cached episode", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-14T12:00:00Z");
    db.insert(watchlist)
      .values({ tmdbType: "tv", tmdbId: 99, title: "Silo", posterPath: null, addedAt: now })
      .run();
    db.insert(tmdbDetails)
      .values({
        cacheKey: "tv:99:season:1",
        payload: {
          season_number: 1,
          name: "S1",
          poster_path: null,
          episodes: [
            { episode_number: 1, name: "a", air_date: null, still_path: null },
            { episode_number: 10, name: "b", air_date: null, still_path: null },
          ],
        },
        updatedAt: now,
      })
      .run();
    db.insert(libraryOverrides)
      .values({ key: "tmdb:tv:99:s1", action: "watched", updatedAt: now })
      .run();

    expect(pendingWatched(db, "justwatch")).toEqual([
      expect.objectContaining({
        key: "tmdb:tv:99:s1",
        seasonNumber: 1,
        episodeNumber: 10,
        tmdbId: 99,
      }),
    ]);
  });

  it("skips keys already exported to the sink", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-14T12:00:00Z");
    db.insert(watchlist)
      .values({ tmdbType: "tv", tmdbId: 99, title: "Silo", posterPath: null, addedAt: now })
      .run();
    db.insert(libraryOverrides)
      .values({ key: "tmdb:tv:99:s2e1", action: "watched", updatedAt: now })
      .run();
    db.insert(exportMarks)
      .values({ sink: "justwatch", contentKey: "tmdb:tv:99:s2e1", remoteId: "jw1", exportedAt: now })
      .run();

    expect(pendingWatched(db, "justwatch")).toEqual([]);
  });
});
