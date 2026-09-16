import {
  extApi,
  isTrustedApiUrl,
  lanFetchInit,
  needsPageFetch,
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

type PageFetchResult = { status: number; body: string };

function headerRecord(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function waitTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      ext.tabs.onUpdated.removeListener(onUpdated);
      if (!settled) {
        settled = true;
        reject(new Error("Timed out opening the tracker dashboard"));
      }
    }, 15000);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ext.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") finish();
    }
    ext.tabs.onUpdated.addListener(onUpdated);
    void ext.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => {});
  });
}

async function trackerTabId(origin: string): Promise<number> {
  const existing = (await ext.tabs.query({ url: `${origin}/*` })).find((tab) => tab.id != null);
  if (existing?.id != null) {
    if (existing.status !== "complete") await waitTabComplete(existing.id);
    return existing.id;
  }
  const tab = await ext.tabs.create({ url: origin, active: false });
  if (tab.id == null) throw new Error("Could not open tracker dashboard");
  await waitTabComplete(tab.id);
  return tab.id;
}

function pageFetch(
  href: string,
  httpMethod: string,
  httpHeaders: Record<string, string>,
  httpBody: string | null
): Promise<PageFetchResult> {
  return fetch(href, { method: httpMethod, headers: httpHeaders, body: httpBody ?? undefined }).then(
    (res) => res.text().then((body) => ({ status: res.status, body }))
  );
}

async function fetchViaPage(url: string, init: RequestInit = {}): Promise<PageFetchResult> {
  const tabId = await trackerTabId(new URL(url).origin);
  const method = init.method ?? "GET";
  const headers = headerRecord(init.headers);
  const body = typeof init.body === "string" ? init.body : null;
  const results = await ext.scripting.executeScript({
    target: { tabId },
    func: pageFetch as never,
    args: [url, method, headers, body],
  });
  const result = results[0]?.result as PageFetchResult | undefined;
  if (!result) throw new Error("Tracker page did not return a response");
  return result;
}

async function trackerFetch(url: string, init: RequestInit = {}): Promise<PageFetchResult> {
  if (needsPageFetch(url)) return fetchViaPage(url, init);
  const res = await fetch(url, lanFetchInit(url, init));
  return { status: res.status, body: await res.text() };
}

function jsonResponse(result: PageFetchResult): Response {
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await loadSettings();
  if (!settings) throw new Error("Set the API URL and token in the extension options");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${settings.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url = `${settings.apiUrl}${path}`;
  const result = await trackerFetch(url, { ...init, headers });
  if (result.status === 401) throw new Error("Extension token rejected");
  return jsonResponse(result);
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

async function probeHealth(url: string): Promise<void> {
  const result = await trackerFetch(url);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${url} → HTTP ${result.status}`);
  }
  const body = JSON.parse(result.body) as { status?: string };
  if (body.status !== "ok") throw new Error(`${url} is not vod-tracker`);
}

/** Direct API at /health, or the Next dashboard proxy at /api/health. */
async function resolveApiBase(origin: string): Promise<string> {
  const attempts: Array<[string, string]> = [
    [`${origin}/health`, origin],
    [`${origin}/api/health`, `${origin}/api`],
  ];
  const errors: string[] = [];
  for (const [url, base] of attempts) {
    try {
      await probeHealth(url);
      return base;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Could not reach vod-tracker (${errors.join("; ")})`);
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
