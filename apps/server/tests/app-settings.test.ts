import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAppSettings, readConfigYaml, writeConfigYaml } from "../src/settings/app-settings";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-"));
}

describe("app settings yaml", () => {
  const prev = {
    MCP_ENABLED: process.env.MCP_ENABLED,
    TV_OS: process.env.TV_OS,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    MQTT_URL: process.env.MQTT_URL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults MCP on and webOS when no file exists", () => {
    const dir = tmpDir();
    expect(readAppSettings(dir)).toMatchObject({ mcpEnabled: true, tvOs: "webos" });
    expect(readConfigYaml(dir)).toContain("mcp:");
  });

  it("persists YAML and overlays environment variables", () => {
    const dir = tmpDir();
    delete process.env.MCP_ENABLED;
    delete process.env.TV_OS;
    delete process.env.TMDB_API_KEY;
    writeConfigYaml(
      "mcp:\n  enabled: false\ntv:\n  os: android\ntmdb:\n  api_key: from-file\n",
      dir
    );
    expect(readAppSettings(dir)).toMatchObject({
      mcpEnabled: false,
      tvOs: "android",
      tmdbApiKey: "from-file",
    });
    process.env.MCP_ENABLED = "true";
    process.env.TMDB_API_KEY = "from-env";
    expect(readAppSettings(dir)).toMatchObject({ mcpEnabled: true, tmdbApiKey: "from-env" });
  });

  it("migrates legacy json + tmdb key files", () => {
    const dir = tmpDir();
    delete process.env.MCP_ENABLED;
    delete process.env.TMDB_API_KEY;
    fs.writeFileSync(path.join(dir, "app.settings.json"), JSON.stringify({ mcpEnabled: false, tvOs: "android" }));
    fs.writeFileSync(path.join(dir, "tmdb.api_key"), "legacy-key\n");
    expect(readAppSettings(dir)).toMatchObject({
      mcpEnabled: false,
      tvOs: "android",
      tmdbApiKey: "legacy-key",
    });
    expect(fs.existsSync(path.join(dir, "config.yaml"))).toBe(true);
  });

  it("rejects invalid tv.os on write", () => {
    const dir = tmpDir();
    expect(() => writeConfigYaml("tv:\n  os: tizen\n", dir)).toThrow(/tv\.os/);
  });
});
