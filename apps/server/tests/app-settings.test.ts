import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAppSettings, writeAppSettings } from "../src/settings/app-settings";

describe("app settings", () => {
  it("defaults to MCP on and webOS when no file exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-"));
    expect(readAppSettings(dir)).toEqual({ mcpEnabled: true, tvOs: "webos" });
  });

  it("persists MCP and TV OS patches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-"));
    expect(writeAppSettings({ mcpEnabled: false, tvOs: "android" }, dir)).toEqual({
      mcpEnabled: false,
      tvOs: "android",
    });
    expect(readAppSettings(dir)).toEqual({ mcpEnabled: false, tvOs: "android" });
    expect(writeAppSettings({ mcpEnabled: true }, dir).tvOs).toBe("android");
  });

  it("ignores a corrupt file and unknown tvOs values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-"));
    fs.writeFileSync(path.join(dir, "app.settings.json"), "{not json");
    expect(readAppSettings(dir).tvOs).toBe("webos");
    fs.writeFileSync(path.join(dir, "app.settings.json"), JSON.stringify({ tvOs: "tizen" }));
    expect(readAppSettings(dir)).toEqual({ mcpEnabled: true, tvOs: "webos" });
  });
});
