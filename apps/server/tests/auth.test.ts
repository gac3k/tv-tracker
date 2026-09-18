import { describe, expect, it } from "vitest";
import { ensureAdmin, initAuth, isPublicAuthPath, runAsUser } from "../src/auth";
import { openDb } from "../src/db/client";
import { ObservationsService } from "../src/observations/observations.service";
import type { PlaybackObservation } from "../src/providers/provider";

function observation(): PlaybackObservation {
  return {
    provider: "netflix",
    profileId: "p1",
    providerContentId: "1",
    mediaType: "movie",
    title: "Heat",
    observedAt: new Date("2026-09-18T12:00:00Z"),
    source: "history",
    raw: {},
  };
}

describe("auth ownership", () => {
  it("keeps MCP routes public", () => {
    expect(isPublicAuthPath("/mcp")).toBe(true);
    expect(isPublicAuthPath("/mcp/sse")).toBe(true);
    expect(isPublicAuthPath("/mcp/messages?sessionId=1")).toBe(true);
    expect(isPublicAuthPath("http://127.0.0.1:3000/mcp/resolve?q=1670")).toBe(true);
    expect(isPublicAuthPath("/library")).toBe(false);
  });

  it("seeds admin/admin and keeps library rows on that user", async () => {
    const db = openDb(":memory:");
    const auth = initAuth(db);
    ensureAdmin();

    const signedIn = await auth.api.signInUsername({
      body: { username: "admin", password: "admin" },
    });
    expect(signedIn?.user.username).toBe("admin");

    const observations = new ObservationsService(db);
    expect(observations.insert([observation()], "test").inserted).toBe(1);
    expect(observations.list()).toHaveLength(1);
    runAsUser("other", () => {
      expect(observations.list()).toHaveLength(0);
    });
  });
});
