import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tmdbApiKey, tmdbApiKeySource } from "../src/artwork/tmdb-key";
import { writeConfigYaml } from "../src/settings/app-settings";

describe("tmdbApiKey", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmdb-key-"));
  const prev = process.env.TMDB_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prev;
    writeConfigYaml("tmdb:\n  api_key: \"\"\n", dir);
  });

  it("prefers the environment over yaml", () => {
    writeConfigYaml("tmdb:\n  api_key: from-file\n", dir);
    process.env.TMDB_API_KEY = "from-env";
    expect(tmdbApiKey(dir)).toBe("from-env");
    expect(tmdbApiKeySource(dir)).toBe("env");
  });

  it("reads yaml when env is unset", () => {
    delete process.env.TMDB_API_KEY;
    writeConfigYaml("tmdb:\n  api_key: from-file\n", dir);
    expect(tmdbApiKey(dir)).toBe("from-file");
    expect(tmdbApiKeySource(dir)).toBe("settings");
    writeConfigYaml("tmdb:\n  api_key: \"\"\n", dir);
    expect(tmdbApiKey(dir)).toBeUndefined();
    expect(tmdbApiKeySource(dir)).toBe(null);
  });
});
