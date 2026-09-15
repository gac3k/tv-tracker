import { describe, expect, it } from "vitest";
import { RemoteLoginService } from "../src/remote-login/remote-login.service";

/**
 * The token gate is the whole security boundary for the streamed browser, so it
 * is tested directly. Launching a real browser belongs in manual verification,
 * not the unit suite.
 */
function withFakeSession(service: RemoteLoginService, overrides: Record<string, unknown> = {}) {
  const session = {
    id: "session-1",
    token: "correct-token-value",
    provider: "netflix",
    startedAt: new Date(),
    width: 1280,
    height: 800,
    context: null,
    page: null,
    cdp: null,
    onFrame: null,
    attached: false,
    expiry: setTimeout(() => undefined, 0),
    ...overrides,
  };
  clearTimeout(session.expiry as NodeJS.Timeout);
  (service as unknown as { session: unknown }).session = session;
  return session;
}

describe("remote login token gate", () => {
  it("refuses any claim when no session is open", () => {
    const service = new RemoteLoginService();
    expect(service.claim("session-1", "correct-token-value")).toBe(false);
  });

  it("accepts the matching session id and token exactly once", () => {
    const service = new RemoteLoginService();
    withFakeSession(service);
    expect(service.claim("session-1", "correct-token-value")).toBe(true);
    // Single-use: a replayed token must not attach a second viewer.
    expect(service.claim("session-1", "correct-token-value")).toBe(false);
  });

  it("refuses a wrong token, a wrong session id, and empty values", () => {
    const service = new RemoteLoginService();
    withFakeSession(service);
    expect(service.claim("session-1", "wrong-token-value!")).toBe(false);
    expect(service.claim("other-session", "correct-token-value")).toBe(false);
    expect(service.claim("session-1", "")).toBe(false);
    expect(service.claim("", "")).toBe(false);
    // None of the failures may have consumed the session.
    expect(service.claim("session-1", "correct-token-value")).toBe(true);
  });

  it("refuses a token of the wrong length without comparing further", () => {
    const service = new RemoteLoginService();
    withFakeSession(service);
    expect(service.claim("session-1", "correct-token-value-plus-extra")).toBe(false);
  });

  it("never exposes the token through the public session view", () => {
    const service = new RemoteLoginService();
    withFakeSession(service);
    expect(service.current?.token).toBe("");
    expect(service.current?.provider).toBe("netflix");
  });
});
