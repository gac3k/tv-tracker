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

export type Settings = {
  apiUrl: string;
  token: string;
};

export type Provider = {
  id: string;
  label: string;
  auth: string;
  cookieDomains: string[];
};

export type Msg =
  | { type: "getSettings" }
  | { type: "saveSettings"; settings: Settings }
  | { type: "listProviders" }
  | { type: "saveSession"; provider: string; domains: string[] };

export type MsgResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function extApi(): BrowserNs {
  const api = (globalThis as unknown as { browser?: BrowserNs; chrome?: BrowserNs }).browser
    ?? (globalThis as unknown as { chrome?: BrowserNs }).chrome;
  if (!api) throw new Error("WebExtension APIs unavailable");
  return api;
}

export type BrowserNs = {
  cookies: {
    getAll: (details: { domain?: string; firstPartyDomain?: string | null }) => Promise<WebExtCookie[]>;
  };
  storage: {
    local: {
      get: (keys?: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  permissions: {
    request: (details: { origins?: string[] }) => Promise<boolean>;
    contains: (details: { origins?: string[] }) => Promise<boolean>;
  };
  runtime: {
    sendMessage: (message: Msg) => Promise<MsgResult<unknown>>;
    openOptionsPage: () => Promise<void>;
    onMessage: {
      addListener: (
        fn: (message: Msg) => MsgResult<unknown> | Promise<MsgResult<unknown>>
      ) => void;
    };
  };
};

export function originPattern(apiUrl: string): string {
  const url = new URL(apiUrl);
  return `${url.protocol}//${url.host}/*`;
}

export function isTrustedApiUrl(apiUrl: string): boolean {
  const url = new URL(apiUrl);
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  if (host === "lan" || host.endsWith(".lan")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (/^10(?:\.\d+){3}$/.test(host)) return true;
  if (/^192\.168(?:\.\d+){2}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])(?:\.\d+){2}$/.test(host)) return true;
  return false;
}

export function normalizeApiUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must be http or https");
  }
  return url.origin;
}
