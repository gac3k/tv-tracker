import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyImportedCookies,
  domainAllowed,
  parseImportedCookies,
  toPlaywrightCookie,
  writeImportedCookies,
} from "../src/browser/cookies";

describe("domainAllowed", () => {
  it("matches a host or subdomain of the allowlist entry", () => {
    expect(domainAllowed("netflix.com", ["netflix.com"])).toBe(true);
    expect(domainAllowed(".netflix.com", ["netflix.com"])).toBe(true);
    expect(domainAllowed("www.netflix.com", ["netflix.com"])).toBe(true);
    expect(domainAllowed("google.com", ["netflix.com"])).toBe(false);
    expect(domainAllowed("notnetflix.com", ["netflix.com"])).toBe(false);
  });
});

describe("toPlaywrightCookie", () => {
  it("maps host-only vs subdomain cookies and SameSite", () => {
    expect(
      toPlaywrightCookie({
        name: "NetflixId",
        value: "abc",
        domain: "www.netflix.com",
        path: "/",
        hostOnly: true,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expirationDate: 1_800_000_000,
      })
    ).toEqual({
      name: "NetflixId",
      value: "abc",
      domain: "www.netflix.com",
      path: "/",
      expires: 1_800_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    expect(
      toPlaywrightCookie({
        name: "sid",
        value: "x",
        domain: "netflix.com",
        hostOnly: false,
        session: true,
        sameSite: "no_restriction",
        secure: true,
      })
    ).toMatchObject({ domain: ".netflix.com", expires: -1, sameSite: "None" });
  });

  it("downgrades SameSite=None when the cookie is not Secure", () => {
    expect(
      toPlaywrightCookie({
        name: "sid",
        value: "x",
        domain: "netflix.com",
        sameSite: "no_restriction",
        secure: false,
      }).sameSite
    ).toBe("Lax");
  });
});

describe("parseImportedCookies", () => {
  it("keeps allowlisted cookies and drops the rest", () => {
    const cookies = parseImportedCookies(
      {
        cookies: [
          { name: "ok", value: "1", domain: "www.netflix.com", expirationDate: 4_000_000_000 },
          { name: "skip", value: "1", domain: "evil.example", expirationDate: 4_000_000_000 },
          { name: "stale", value: "1", domain: "netflix.com", expirationDate: 1 },
        ],
      },
      ["netflix.com"]
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe("ok");
  });

  it("rejects a payload with nothing usable", () => {
    expect(() =>
      parseImportedCookies({ cookies: [{ name: "x", value: "1", domain: "evil.example" }] }, ["netflix.com"])
    ).toThrow(/No cookies matched/);
  });

  it("rejects malformed bodies without echoing cookie values", () => {
    expect(() => parseImportedCookies({ cookies: "nope" }, ["netflix.com"])).toThrow(/Invalid session payload/);
  });

  it("accepts Firefox cookies with null partitionKey, extra fields, and large values", () => {
    const cookies = parseImportedCookies(
      {
        cookies: [
          {
            name: "NetflixId",
            value: "n".repeat(8000),
            domain: ".netflix.com",
            path: "/",
            hostOnly: false,
            httpOnly: true,
            secure: true,
            session: false,
            expirationDate: 4_000_000_000,
            sameSite: "unspecified",
            firstPartyDomain: "",
            storeId: "firefox-default",
            partitionKey: null,
          },
          {
            name: "broken",
            value: 1,
            domain: "netflix.com",
          },
        ],
      },
      ["netflix.com"]
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe("NetflixId");
    expect(cookies[0]?.value).toHaveLength(8000);
  });
});

describe("writeImportedCookies / applyImportedCookies", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vod-cookies-"));

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes 0600 json and applies it once", async () => {
    const cookies = parseImportedCookies(
      { cookies: [{ name: "NetflixId", value: "secret", domain: "netflix.com", expirationDate: 4_000_000_000 }] },
      ["netflix.com"]
    );
    const file = path.join(tmp, "cookies.json");
    writeImportedCookies("netflix", cookies, file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const added: unknown[] = [];
    const n = await applyImportedCookies({ addCookies: async (list) => { added.push(...list); } }, "netflix", file);
    expect(n).toBe(1);
    expect(added).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.applied`)).toBe(true);

    const again = await applyImportedCookies(
      { addCookies: async () => { throw new Error("should not run"); } },
      "netflix",
      file
    );
    expect(again).toBe(0);
  });
});
