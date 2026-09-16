import fs from "node:fs";
import path from "node:path";
import type { Cookie } from "playwright";
import { z } from "zod";
import { config } from "../config";

const importBody = z.object({
  cookies: z.array(z.unknown()).min(1).max(800),
});

export type WebExtCookie = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: "no_restriction" | "lax" | "strict" | "unspecified";
  partitionKey?: { topLevelSite: string };
};

const MAX_VALUE = 65_536;

export function cookieFile(provider: string): string {
  return path.join(config.browserProfileDir(provider), "cookies.json");
}

/** True when `cookieDomain` is the allowlisted host or a subdomain of it. */
export function domainAllowed(cookieDomain: string, allowed: string[]): boolean {
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  return allowed.some((entry) => {
    const base = entry.replace(/^\./, "").toLowerCase();
    return domain === base || domain.endsWith(`.${base}`);
  });
}

function sameSite(value: WebExtCookie["sameSite"], secure: boolean): Cookie["sameSite"] {
  if (value === "strict") return "Strict";
  if (value === "no_restriction") return secure ? "None" : "Lax";
  return "Lax";
}

function sameSiteFromUnknown(value: unknown): WebExtCookie["sameSite"] {
  if (value == null) return undefined;
  const normalized = String(value).toLowerCase().replace(/-/g, "_");
  if (normalized === "strict") return "strict";
  if (normalized === "no_restriction" || normalized === "none") return "no_restriction";
  if (normalized === "unspecified") return "unspecified";
  return "lax";
}

/** Pull the fields we need off a Firefox/Chrome cookie object. Extra keys and nulls are ignored. */
export function fromUnknownCookie(raw: unknown): WebExtCookie | null {
  if (raw == null || typeof raw !== "object") return null;
  const cookie = raw as Record<string, unknown>;
  if (typeof cookie.name !== "string" || cookie.name.length === 0 || cookie.name.length > 256) {
    return null;
  }
  if (typeof cookie.domain !== "string" || cookie.domain.length === 0 || cookie.domain.length > 253) {
    return null;
  }
  if (typeof cookie.value !== "string" || cookie.value.length > MAX_VALUE) return null;
  const partition =
    cookie.partitionKey != null && typeof cookie.partitionKey === "object"
      ? (cookie.partitionKey as { topLevelSite?: unknown }).topLevelSite
      : undefined;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: typeof cookie.path === "string" ? cookie.path : undefined,
    hostOnly: cookie.hostOnly === true,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    session: cookie.session === true,
    expirationDate: typeof cookie.expirationDate === "number" ? cookie.expirationDate : undefined,
    sameSite: sameSiteFromUnknown(cookie.sameSite),
    partitionKey: typeof partition === "string" && partition.length > 0 ? { topLevelSite: partition } : undefined,
  };
}

export function toPlaywrightCookie(cookie: WebExtCookie): Cookie {
  const hostOnly = cookie.hostOnly === true;
  const domain = cookie.domain.replace(/^\./, "");
  const secure = cookie.secure === true;
  const expires =
    cookie.session || cookie.expirationDate == null
      ? -1
      : Math.floor(cookie.expirationDate);
  return {
    name: cookie.name,
    value: cookie.value,
    domain: hostOnly ? domain : `.${domain}`,
    path: cookie.path || "/",
    expires,
    httpOnly: cookie.httpOnly === true,
    secure,
    sameSite: sameSite(cookie.sameSite, secure),
    ...(cookie.partitionKey?.topLevelSite
      ? { partitionKey: cookie.partitionKey.topLevelSite }
      : {}),
  };
}

export function parseImportedCookies(body: unknown, allowedDomains: string[]): Cookie[] {
  const parsed = importBody.safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid session payload");
  }
  const now = Date.now() / 1000;
  const cookies: Cookie[] = [];
  for (const raw of parsed.data.cookies) {
    const cookie = fromUnknownCookie(raw);
    if (!cookie) continue;
    if (!domainAllowed(cookie.domain, allowedDomains)) continue;
    if (cookie.expirationDate != null && cookie.expirationDate < now) continue;
    cookies.push(toPlaywrightCookie(cookie));
  }
  if (cookies.length === 0) {
    throw new Error("No cookies matched this provider");
  }
  return cookies;
}

export function writeImportedCookies(provider: string, cookies: Cookie[], file = cookieFile(provider)): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cookies), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/** Apply a pending extension import once, then rename so later syncs can refresh cookies. */
export async function applyImportedCookies(
  context: { addCookies: (cookies: Cookie[]) => Promise<void> },
  provider: string,
  file = cookieFile(provider)
): Promise<number> {
  if (!fs.existsSync(file)) return 0;
  const cookies = JSON.parse(fs.readFileSync(file, "utf8")) as Cookie[];
  await context.addCookies(cookies);
  fs.renameSync(file, `${file}.applied`);
  return cookies.length;
}
