import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client";
import { ArtworkService } from "../src/artwork/artwork.service";
import { LibraryService } from "../src/library/library.service";
import { ProviderRegistry } from "../src/providers/registry.service";
import { WatchlistService } from "../src/watchlist/watchlist.service";

function service() {
  const db = openDb(":memory:");
  const registry = new ProviderRegistry(db);
  const artwork = new ArtworkService(db);
  const library = new LibraryService(db, artwork, registry);
  return new WatchlistService(db, library);
}

describe("watchlist", () => {
  it("adds, lists, and removes a title", () => {
    const watchlist = service();
    watchlist.add({ tmdbType: "tv", tmdbId: 1396, title: "Breaking Bad", posterPath: "/bb.jpg" });
    watchlist.add({ tmdbType: "movie", tmdbId: 27205, title: "Inception", posterPath: null });
    expect(watchlist.list().map((item) => item.title)).toEqual(["Inception", "Breaking Bad"]);
    expect(watchlist.remove("tv", 1396)).toEqual({ removed: true });
    expect(watchlist.list()).toHaveLength(1);
    expect(watchlist.remove("tv", 1396)).toEqual({ removed: false });
  });
});
