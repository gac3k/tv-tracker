import { describe, expect, it } from "vitest";
import { isContinueTitle, type LibraryItem } from "../src/library/aggregate";
import { applyOverride, isHidden, overrideMap } from "../src/library/overrides";

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    key: "netflix:ep-1",
    provider: "netflix",
    providerContentId: "ep-1",
    mediaType: "episode",
    title: "Panna",
    showTitle: "1670",
    seasonNumber: 1,
    episodeNumber: 6,
    progress: 40,
    progressSource: "provider",
    remainingSeconds: null,
    completed: false,
    source: "continue_watching",
    watchedAt: new Date("2026-09-01T00:00:00Z"),
    observedAt: new Date("2026-09-01T00:00:00Z"),
    observationCount: 1,
    ...overrides,
  };
}

describe("library overrides", () => {
  it("hides one episode by content key without hiding the rest of the show", () => {
    const overrides = overrideMap([{ key: "netflix:ep-1", action: "hidden" }]);
    expect(isHidden(item(), overrides)).toBe(true);
    expect(isHidden(item({ providerContentId: "ep-2", key: "netflix:ep-2" }), overrides)).toBe(
      false
    );
  });

  it("hides every episode when the title key is hidden", () => {
    const overrides = overrideMap([{ key: "title:1670", action: "hidden" }]);
    expect(isHidden(item(), overrides)).toBe(true);
    expect(isHidden(item({ providerContentId: "ep-9", key: "netflix:ep-9" }), overrides)).toBe(
      true
    );
    expect(isHidden(item({ showTitle: "Shogun", title: "Anjin" }), overrides)).toBe(false);
  });

  it("marks an episode watched without dropping the series from Continue", () => {
    const overrides = overrideMap([{ key: "netflix:ep-1", action: "watched" }]);
    const marked = applyOverride(item(), overrides);
    expect(marked.completed).toBe(true);
    expect(marked.titleWatched).toBeFalsy();
    expect(isContinueTitle(marked)).toBe(true);
  });

  it("drops a series from Continue when the title is marked watched", () => {
    const overrides = overrideMap([{ key: "title:1670", action: "watched" }]);
    const marked = applyOverride(item({ completed: true, progress: 90 }), overrides);
    expect(marked.titleWatched).toBe(true);
    expect(isContinueTitle(marked)).toBe(false);
  });

  it("marks an episode watched from a TMDB season key", () => {
    const overrides = overrideMap([{ key: "tmdb:tv:99:s1", action: "watched" }]);
    const marked = applyOverride(item(), overrides, { id: 99, type: "tv" });
    expect(marked.completed).toBe(true);
    expect(marked.titleWatched).toBeFalsy();
    expect(isContinueTitle(marked)).toBe(true);
  });

  it("ignores TMDB keys for a different title", () => {
    const overrides = overrideMap([{ key: "tmdb:tv:99:s1", action: "watched" }]);
    const marked = applyOverride(item(), overrides, { id: 12, type: "tv" });
    expect(marked.completed).toBe(false);
  });
});
