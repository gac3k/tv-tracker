import {
  extApi,
  isTrustedApiUrl,
  normalizeApiUrl,
  type Msg,
  type MsgResult,
  type Provider,
  type Settings,
  type WebExtCookie,
} from "./shared.js";

const ext = extApi();

async function loadSettings(): Promise<Settings | null> {
  const stored = await ext.storage.local.get(["apiUrl", "token"]);
  const apiUrl = typeof stored.apiUrl === "string" ? stored.apiUrl : "";
  const token = typeof stored.token === "string" ? stored.token : "";
  if (!apiUrl || !token) return null;
  return { apiUrl, token };
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await loadSettings();
  if (!settings) throw new Error("Set the API URL and token in the extension options");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${settings.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${settings.apiUrl}${path}`, { ...init, headers });
  if (res.status === 401) throw new Error("Extension token rejected");
  return res;
}

async function cookiesFor(domain: string): Promise<WebExtCookie[]> {
  try {
    return await ext.cookies.getAll({ domain, firstPartyDomain: null });
  } catch {
    return await ext.cookies.getAll({ domain });
  }
}

function cookieKey(cookie: WebExtCookie): string {
  return `${cookie.domain}\0${cookie.path ?? "/"}\0${cookie.name}\0${cookie.partitionKey?.topLevelSite ?? ""}`;
}

function serializeCookie(cookie: WebExtCookie): WebExtCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    hostOnly: cookie.hostOnly,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: cookie.session,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite,
    ...(cookie.partitionKey?.topLevelSite
      ? { partitionKey: { topLevelSite: cookie.partitionKey.topLevelSite } }
      : {}),
  };
}

async function collectCookies(domains: string[]): Promise<WebExtCookie[]> {
  const byKey = new Map<string, WebExtCookie>();
  for (const domain of domains) {
    for (const cookie of await cookiesFor(domain)) {
      byKey.set(cookieKey(cookie), cookie);
    }
  }
  return [...byKey.values()];
}

async function isTrackerHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}

/** Direct API at /health, or the Next dashboard proxy at /api/health. */
async function resolveApiBase(origin: string): Promise<string> {
  if (await isTrackerHealth(`${origin}/health`)) return origin;
  if (await isTrackerHealth(`${origin}/api/health`)) return `${origin}/api`;
  throw new Error("Could not reach vod-tracker (tried /health and /api/health)");
}

async function saveSettings(settings: Settings): Promise<Settings> {
  const origin = normalizeApiUrl(settings.apiUrl);
  const token = settings.token.trim();
  if (token.length < 16) throw new Error("Token looks too short");
  if (!isTrustedApiUrl(origin)) {
    throw new Error("Use HTTPS unless the host is localhost, a private IP, or *.lan/*.local");
  }
  const apiUrl = await resolveApiBase(origin);
  await ext.storage.local.set({ apiUrl, token });
  return { apiUrl, token };
}

async function listProviders(): Promise<Provider[]> {
  const res = await apiFetch("/providers");
  if (!res.ok) throw new Error(`Could not list providers (${res.status})`);
  const body = (await res.json()) as { providers?: Provider[] };
  return (body.providers ?? []).filter((item) => item.cookieDomains?.length);
}

async function saveSession(provider: string, domains: string[]): Promise<number> {
  const cookies = await collectCookies(domains);
  if (cookies.length === 0) {
    throw new Error("No cookies found — are you signed in to this provider in Firefox?");
  }
  const res = await apiFetch(`/providers/${encodeURIComponent(provider)}/session`, {
    method: "POST",
    body: JSON.stringify({ cookies: cookies.map(serializeCookie) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Save failed (${res.status})`);
  }
  const body = (await res.json()) as { saved?: number };
  return body.saved ?? cookies.length;
}

ext.runtime.onMessage.addListener((message: Msg): Promise<MsgResult<unknown>> => {
  return (async () => {
    try {
      switch (message.type) {
        case "getSettings":
          return { ok: true, value: await loadSettings() };
        case "saveSettings":
          return { ok: true, value: await saveSettings(message.settings) };
        case "listProviders":
          return { ok: true, value: await listProviders() };
        case "saveSession":
          return { ok: true, value: await saveSession(message.provider, message.domains) };
        default:
          return { ok: false, error: "Unknown message" };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })();
});
