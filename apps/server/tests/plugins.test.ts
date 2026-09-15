import { describe, expect, it } from "vitest";
import { dispatchPluginEvent, type PluginEvent } from "../src/plugins/plugin";
import { openDb } from "../src/db/client";

describe("plugin events", () => {
  it("dispatches sync and watched to enabled listeners only", async () => {
    const seen: PluginEvent["type"][] = [];

    const listener = {
      async on(event: PluginEvent) {
        seen.push(event.type);
        return { exported: 2, unmatched: 0 };
      },
    };
    const quiet = {};
    const db = openDb(":memory:");
    const settings = { enabled: true, includeData: false, values: {} };

    const results = await dispatchPluginEvent(
      [
        { id: "listener", enabled: true, instance: listener, settings },
        { id: "quiet", enabled: true, instance: quiet, settings },
        { id: "off", enabled: false, instance: listener, settings },
      ],
      { type: "sync" },
      { db }
    );

    expect(seen).toEqual(["sync"]);
    expect(results).toEqual([
      expect.objectContaining({ plugin: "listener", status: "success", exported: 2, unmatched: 0 }),
    ]);

    await dispatchPluginEvent(
      [{ id: "listener", enabled: true, instance: listener, settings }],
      { type: "watched", keys: ["netflix:1"] },
      { db }
    );
    expect(seen).toEqual(["sync", "watched"]);
  });

  it("forwards optional job log lines from a plugin", async () => {
    const lines: string[] = [];
    await dispatchPluginEvent(
      [
        {
          id: "listener",
          enabled: true,
          instance: {
            async on(_event, ctx) {
              await ctx.log?.("info", "plugin said hello");
              return { exported: 1 };
            },
          },
          settings: { enabled: true, includeData: false, values: {} },
        },
      ],
      { type: "sync" },
      {
        db: openDb(":memory:"),
        log: (_level, message) => {
          lines.push(message);
        },
      }
    );
    expect(lines).toEqual(["plugin said hello"]);
  });
});
