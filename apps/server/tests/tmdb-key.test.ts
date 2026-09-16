import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setTmdbApiKey, tmdbApiKey, tmdbApiKeySource } from "../src/artwork/tmdb-key";

describe("tmdbApiKey", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmdb-key-"));
  const prev = process.env.TMDB_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prev;
    setTmdbApiKey("", dir);
  });

  it("prefers the environment over a saved settings file", () => {
    setTmdbApiKey("from-file", dir);
    process.env.TMDB_API_KEY = "from-env";
    expect(tmdbApiKey(dir)).toBe("from-env");
    expect(tmdbApiKeySource(dir)).toBe("env");
  });

  it("reads and clears the settings file when env is unset", () => {
    delete process.env.TMDB_API_KEY;
    setTmdbApiKey("from-file", dir);
    expect(tmdbApiKey(dir)).toBe("from-file");
    expect(tmdbApiKeySource(dir)).toBe("settings");
    setTmdbApiKey("", dir);
    expect(tmdbApiKey(dir)).toBeUndefined();
    expect(tmdbApiKeySource(dir)).toBe(null);
  });
});
