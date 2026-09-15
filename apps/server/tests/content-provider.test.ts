import { describe, expect, it } from "vitest";
import { ContentProvider, discoverContentProviders } from "../src/providers/decorate";
import { mergeProviderValues, redactValues } from "../src/providers/registry.service";
import type { VodProvider } from "../src/providers/provider";

describe("ContentProvider registry", () => {
  it("discovers a decorated adapter by id", () => {
    @ContentProvider({
      id: "fixture",
      label: "Fixture",
      auth: "credentials",
      fields: [{ key: "token", label: "Token", type: "secret" }],
      parserVersion: "test-1",
    })
    class FixtureProvider implements VodProvider {
      readonly name = "fixture";
      async isAuthenticated() {
        return { authenticated: false };
      }
      async sync() {
        return [];
      }
      async login() {}
    }

    void FixtureProvider;
    const found = discoverContentProviders().find((entry) => entry.meta.id === "fixture");
    expect(found?.instance.name).toBe("fixture");
    expect(found?.meta.fields[0]?.type).toBe("secret");
  });
});

describe("redactValues", () => {
  it("masks secrets and leaves public fields", () => {
    const fields = [
      { key: "serverUrl", label: "URL", type: "url" as const },
      { key: "apiKey", label: "Key", type: "secret" as const },
    ];
    expect(redactValues(fields, { serverUrl: "https://jf.home", apiKey: "s3cret" })).toEqual({
      serverUrl: "https://jf.home",
      apiKey: null,
    });
    expect(redactValues(fields, {})).toEqual({ serverUrl: "", apiKey: "" });
  });
});

describe("mergeProviderValues", () => {
  it("keeps stored secrets when the patch is blank", () => {
    expect(mergeProviderValues({ apiKey: "old", user: "a" }, { apiKey: "  ", serverUrl: "https://x" })).toEqual({
      apiKey: "old",
      user: "a",
      serverUrl: "https://x",
    });
  });
});
