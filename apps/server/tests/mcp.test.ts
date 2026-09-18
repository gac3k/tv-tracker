import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "../src/mcp/mcp";
import type { PlaybackLaunch } from "../src/library/playback";

const launch: PlaybackLaunch = {
  query: "1670",
  title: "1670",
  showTitle: "1670",
  provider: "netflix",
  providerContentId: "80189685",
  mediaType: "episode",
  seasonNumber: 1,
  episodeNumber: 3,
  progress: 40,
  completed: false,
  url: "https://www.netflix.com/watch/80189685",
  webos: { appId: "netflix", contentId: "m=https://www.netflix.com/watch/80189685" },
  android: { deeplink: "https://www.netflix.com/watch/80189685" },
};

describe("MCP JSON-RPC", () => {
  it("lists the resolve_playback tool", () => {
    const res = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, () => null);
    expect(res?.result).toEqual({
      tools: [
        expect.objectContaining({ name: "resolve_playback" }),
      ],
    });
  });

  it("returns the webOS launcher payload from resolve_playback", () => {
    const res = handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "resolve_playback", arguments: { query: "1670" } },
      },
      () => launch
    );
    const text = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text ?? "{}")).toEqual({
      id: "netflix",
      contentId: "m=https://www.netflix.com/watch/80189685",
    });
  });

  it("returns an Android deeplink when the TV OS is android", () => {
    const res = handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "resolve_playback", arguments: { query: "1670" } },
      },
      () => launch,
      "android"
    );
    const text = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text ?? "{}")).toEqual({
      deeplink: "https://www.netflix.com/watch/80189685",
    });
  });

  it("ignores initialized notifications", () => {
    expect(handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, () => null)).toBeNull();
  });
});
