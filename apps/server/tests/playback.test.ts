import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../src/library/aggregate";
import { pickPlayback, toPlaybackLaunch } from "../src/library/playback";

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    key: "netflix:801",
    provider: "netflix",
    providerContentId: "80189685",
    mediaType: "episode",
    title: "Episode 3",
    showTitle: "1670",
    seasonNumber: 1,
    episodeNumber: 3,
    progress: 40,
    progressSource: "provider",
    remainingSeconds: null,
    completed: false,
    source: "continue_watching",
    watchedAt: new Date("2026-09-11T12:00:00Z"),
    observedAt: new Date("2026-09-11T12:00:00Z"),
    observationCount: 1,
    ...overrides,
  };
}

describe("pickPlayback", () => {
  it("matches a title even when the query is a full Assist sentence", () => {
    const picked = pickPlayback([item()], "Puść następny odcinek 1670");
    expect(picked?.showTitle).toBe("1670");
    expect(picked?.providerContentId).toBe("80189685");
  });

  it("prefers the in-progress episode of a matching title", () => {
    const picked = pickPlayback(
      [
        item({
          key: "netflix:800",
          providerContentId: "800",
          episodeNumber: 2,
          progress: 100,
          completed: true,
          source: "history",
        }),
        item(),
      ],
      "1670"
    );
    expect(picked?.episodeNumber).toBe(3);
    expect(picked?.completed).toBe(false);
  });

  it("returns null when nothing matches", () => {
    expect(pickPlayback([item()], "The Bear")).toBeNull();
  });
});

describe("toPlaybackLaunch", () => {
  it("includes the webOS Netflix content target", () => {
    const launch = toPlaybackLaunch(item(), "1670");
    expect(launch.url).toBe("https://www.netflix.com/watch/80189685");
    expect(launch.webos).toEqual({
      appId: "netflix",
      contentId: "m=https://www.netflix.com/watch/80189685",
    });
  });
});
