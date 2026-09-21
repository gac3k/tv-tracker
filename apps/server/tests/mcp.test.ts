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
  tvUrl: { id: "netflix", contentId: "m=https://www.netflix.com/watch/80189685" },
};

describe("MCP JSON-RPC", () => {
  it("advertises tools on initialize", async () => {
    const res = await handleMcpRequest({ jsonrpc: "2.0", id: 0, method: "initialize" }, () => null);
    expect(res?.result).toEqual({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "vod-tracker", version: "0.1.0" },
    });
  });

  it("lists playback and suggestion tools", async () => {
    const res = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, () => null);
    expect(res?.result).toEqual({
      tools: [
        expect.objectContaining({ name: "resolve_playback" }),
        expect.objectContaining({ name: "suggest_continue" }),
        expect.objectContaining({ name: "suggest_watch" }),
      ],
    });
  });

  it("returns tvUrl from resolve_playback", async () => {
    const res = await handleMcpRequest(
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
      tvUrl: { id: "netflix", contentId: "m=https://www.netflix.com/watch/80189685" },
    });
  });

  it("returns an Android tvUrl when the launch already has one", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "resolve_playback", arguments: { query: "1670" } },
      },
      () => ({ ...launch, tvUrl: "https://www.netflix.com/watch/80189685" })
    );
    const text = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text ?? "{}")).toEqual({
      tvUrl: "https://www.netflix.com/watch/80189685",
    });
  });

  it("returns in-progress titles from suggest_continue", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "suggest_continue", arguments: { limit: 2 } } },
      {
        resolve: () => null,
        continueWatching: (limit) =>
          [
            {
              title: "The Bear",
              kind: "series" as const,
              reason: "in_progress" as const,
              provider: "netflix",
              seasonNumber: 2,
              episodeNumber: 4,
              progress: 40,
            },
          ].slice(0, limit),
      }
    );
    const text = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text ?? "{}").items[0]).toMatchObject({ title: "The Bear", reason: "in_progress" });
  });

  it("returns watchlist picks from suggest_watch", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "suggest_watch", arguments: { kind: "movie" } },
      },
      {
        resolve: () => null,
        suggestWatch: (kind) => [
          {
            title: "Dune",
            kind: kind ?? "movie",
            reason: "watchlist" as const,
            provider: null,
            seasonNumber: null,
            episodeNumber: null,
            progress: null,
          },
        ],
      }
    );
    const text = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text ?? "{}").items[0]).toMatchObject({ title: "Dune", kind: "movie" });
  });

  it("ignores initialized notifications", async () => {
    expect(await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, () => null)).toBeNull();
  });
});
