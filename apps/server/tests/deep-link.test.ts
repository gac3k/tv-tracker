import { describe, expect, it } from "vitest";
import { androidLaunch, providerUrl, webosLaunch } from "../src/library/deepLink";

describe("provider deep links", () => {
  it("builds a Netflix watch URL from the numeric video id", () => {
    expect(providerUrl("netflix", "70143634", "episode")).toBe(
      "https://www.netflix.com/watch/70143634"
    );
  });

  it("rejects a non-numeric Netflix id rather than emitting a dead link", () => {
    expect(providerUrl("netflix", "not-a-number", "movie")).toBeNull();
  });

  it("builds a Prime detail URL from the gti", () => {
    expect(providerUrl("prime", "amzn1.dv.gti.0a4e40bd", "movie")).toBe(
      "https://www.primevideo.com/detail/amzn1.dv.gti.0a4e40bd"
    );
  });

  it("builds a Max watch URL from the video uuid", () => {
    expect(providerUrl("max", "5033e602-73e5-4204-b6ec-5283c6d522ca", "episode")).toBe(
      "https://play.hbomax.com/video/watch/5033e602-73e5-4204-b6ec-5283c6d522ca"
    );
  });

  it("picks the Apple route segment from the media type", () => {
    expect(providerUrl("apple", "umc.cmc.40za8", "episode")).toBe(
      "https://tv.apple.com/episode/umc.cmc.40za8"
    );
    expect(providerUrl("apple", "umc.cmc.40za8", "movie")).toBe(
      "https://tv.apple.com/movie/umc.cmc.40za8"
    );
  });

  it("builds a Disney+ play URL for both media types", () => {
    expect(providerUrl("disney", "04052bf2-70e0", "episode")).toBe(
      "https://www.disneyplus.com/play/04052bf2-70e0"
    );
    expect(providerUrl("disney", "04052bf2-70e0", "movie")).toBe(
      "https://www.disneyplus.com/play/04052bf2-70e0"
    );
  });

  it("builds a Jellyfin details URL when a server is configured", () => {
    expect(
      providerUrl("jellyfin", "abc-123", "movie", { jellyfinServerUrl: "https://media.home/" })
    ).toBe("https://media.home/web/#/details?id=abc-123");
    expect(providerUrl("jellyfin", "abc-123", "movie")).toBeNull();
  });

  it("returns null for unknown providers and empty ids", () => {
    expect(providerUrl("hulu", "123", "movie")).toBeNull();
    expect(providerUrl("netflix", "", "movie")).toBeNull();
    expect(providerUrl("disney", "   ", "movie")).toBeNull();
  });

  it("builds a Netflix webOS launch with the m= watch URL", () => {
    expect(webosLaunch("netflix", "70143634", "episode")).toEqual({
      appId: "netflix",
      contentId: "m=https://www.netflix.com/watch/70143634",
    });
  });

  it("builds Prime/Max/Disney/Apple webOS launches from the web URL", () => {
    expect(webosLaunch("prime", "amzn1.dv.gti.0a4e40bd", "movie")).toEqual({
      appId: "amazon",
      contentId: "https://www.primevideo.com/detail/amzn1.dv.gti.0a4e40bd",
    });
    expect(webosLaunch("max", "5033e602-73e5-4204-b6ec-5283c6d522ca", "episode")?.appId).toBe(
      "com.hbo.hbomax"
    );
    expect(webosLaunch("disney", "04052bf2-70e0", "movie")?.appId).toBe("com.disney.disneyplus-prod");
    expect(webosLaunch("apple", "umc.cmc.40za8", "episode")?.appId).toBe("com.apple.atve.webos.appletv");
  });

  it("builds a Jellyfin webOS content id from the item id", () => {
    expect(webosLaunch("jellyfin", "abc-123", "movie")).toEqual({
      appId: "org.jellyfin.webos",
      contentId: "id=abc-123",
    });
  });
});

describe("android TV deep links", () => {
  it("uses the Netflix watch URL as the launcher deeplink", () => {
    expect(androidLaunch("netflix", "70143634", "episode")).toEqual({
      deeplink: "https://www.netflix.com/watch/70143634",
    });
  });

  it("uses the Prime app.primevideo.com gti URL", () => {
    expect(androidLaunch("prime", "amzn1.dv.gti.0a4e40bd", "movie")).toEqual({
      deeplink: "https://app.primevideo.com/detail?gti=amzn1.dv.gti.0a4e40bd",
    });
  });

  it("reuses the Disney/Apple/Max https URLs", () => {
    expect(androidLaunch("disney", "04052bf2-70e0", "movie")?.deeplink).toBe(
      "https://www.disneyplus.com/play/04052bf2-70e0"
    );
    expect(androidLaunch("apple", "umc.cmc.40za8", "episode")?.deeplink).toBe(
      "https://tv.apple.com/episode/umc.cmc.40za8"
    );
    expect(androidLaunch("max", "5033e602-73e5-4204-b6ec-5283c6d522ca", "episode")?.deeplink).toContain(
      "play.hbomax.com"
    );
  });

  it("returns the Jellyfin Android TV package because that app has no content URI", () => {
    expect(androidLaunch("jellyfin", "abc-123", "movie")).toEqual({
      deeplink: "org.jellyfin.androidtv",
    });
  });
});
