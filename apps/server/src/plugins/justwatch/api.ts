import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import { ProviderAuthenticationError, ProviderNetworkError, ProviderRateLimitError } from "../../providers/errors";
import type { SearchNode, SeasonNode } from "./match";

const GRAPHQL = "https://apis.justwatch.com/graphql";
const FIREBASE_KEY = "AIzaSyDv6JIzdDvbTBS-JWdR4Kl22UvgWGAyuo8";
const APP_VERSION = "3.13.0-web-web";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0";
const NAME = "justwatch";

export const SEARCH_QUERY = `query SearchTitle($filter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR) {
    edges { node { id objectType content(country: $country, language: $language) { title originalReleaseYear externalIds { imdbId tmdbId } } } }
  }
}`;

export const SHOW_QUERY = `query GetTitle($nodeId: ID!, $language: Language!, $country: Country!) {
  node(id: $nodeId) {
    ... on Show {
      id
      seasons {
        id
        content(country: $country, language: $language) { seasonNumber }
        episodes { id content(country: $country, language: $language) { episodeNumber seasonNumber } }
      }
    }
  }
}`;

export const SET_SEEN_MUTATION = `mutation SetInSeenlist($input: SetInSeenlistInput!) {
  setInSeenlist(input: $input) { title { id } }
}`;

interface TokenFile {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  deviceId: string;
}

function tokenPath(): string {
  return path.join(config.dataDir, "tokens", "justwatch.json");
}

function readToken(): TokenFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenPath(), "utf8")) as TokenFile;
    if (!raw.accessToken || !raw.deviceId) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeToken(token: TokenFile): void {
  const dir = path.dirname(tokenPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokenPath(), JSON.stringify(token), { mode: 0o600 });
}

function deviceId(): string {
  return readToken()?.deviceId ?? randomBytes(16).toString("base64url");
}

interface FirebaseAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

function parseAuth(json: {
  idToken?: string;
  id_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  expiresIn?: string;
  expires_in?: string;
  email?: string;
  displayName?: string;
}): FirebaseAuth | null {
  const accessToken = json.idToken ?? json.id_token;
  const refreshToken = json.refreshToken ?? json.refresh_token;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Number(json.expiresIn ?? json.expires_in ?? 3600) * 1000,
    email: json.email ?? json.displayName ?? "",
  };
}

async function postAuth(url: string, body: BodyInit, contentType: string): Promise<FirebaseAuth> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType, "user-agent": UA },
      body,
    });
  } catch (err) {
    throw new ProviderNetworkError(NAME, "JustWatch login request failed", { cause: err });
  }
  const json = (await res.json().catch(() => ({}))) as Parameters<typeof parseAuth>[0] & {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new ProviderAuthenticationError(NAME, json.error?.message ?? `JustWatch login failed (${res.status})`);
  }
  const parsed = parseAuth(json);
  if (!parsed) throw new ProviderAuthenticationError(NAME, "JustWatch login did not return a token");
  return parsed;
}

export async function loginWithPassword(email: string, password: string): Promise<{ profileName: string }> {
  const result = await postAuth(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
    JSON.stringify({ email, password, returnSecureToken: true }),
    "application/json"
  );
  writeToken({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    email: result.email || email,
    deviceId: deviceId(),
  });
  return { profileName: result.email || email };
}

async function refresh(current: TokenFile): Promise<TokenFile> {
  const result = await postAuth(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken }),
    "application/x-www-form-urlencoded"
  );
  const next: TokenFile = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    email: current.email,
    deviceId: current.deviceId,
  };
  writeToken(next);
  return next;
}

export async function ensureToken(email: string, password: string): Promise<TokenFile> {
  const stored = readToken();
  if (stored && stored.expiresAt - 60_000 > Date.now()) return stored;
  if (stored?.refreshToken) {
    try {
      return await refresh(stored);
    } catch {
      // fall through to password login
    }
  }
  if (!email || !password) {
    throw new ProviderAuthenticationError(NAME, "Set the JustWatch email and password in Providers.");
  }
  await loginWithPassword(email, password);
  const next = readToken();
  if (!next) throw new ProviderAuthenticationError(NAME, "JustWatch login did not persist a token");
  return next;
}

export function storedProfile(): string | undefined {
  return readToken()?.email;
}

export function hasFreshToken(): boolean {
  const stored = readToken();
  return stored != null && stored.expiresAt - 60_000 > Date.now();
}

interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

export async function graphql<T>(
  token: TokenFile,
  query: string,
  variables: Record<string, unknown>,
  country: string,
  language: string
): Promise<T> {
  const sg = `c=${country}&l=${language}&d=${token.deviceId}&p=${APP_VERSION}`;
  let res: Response;
  try {
    res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        authorization: `Bearer ${token.accessToken}`,
        "app-version": APP_VERSION,
        "device-id": token.deviceId,
        origin: "https://www.justwatch.com",
        referer: "https://www.justwatch.com/",
        sg,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new ProviderNetworkError(NAME, "JustWatch GraphQL request failed", { cause: err });
  }
  const json = (await res.json().catch(() => ({}))) as GqlResult<T>;
  const code = json.errors?.[0]?.extensions?.code;
  if (res.status === 401 || res.status === 403 || code === "AUTHORIZATION_REQUIRED") {
    throw new ProviderAuthenticationError(NAME, "JustWatch rejected the session. Re-test the login.");
  }
  if (res.status === 429) {
    throw new ProviderRateLimitError(NAME, "JustWatch rate-limited the export");
  }
  if (!res.ok || json.errors?.length) {
    const message = json.errors?.[0]?.message ?? `JustWatch ${res.status}`;
    throw new ProviderNetworkError(NAME, message);
  }
  if (!json.data) throw new ProviderNetworkError(NAME, "JustWatch returned an empty GraphQL response");
  return json.data;
}

export async function searchTitles(
  token: TokenFile,
  country: string,
  language: string,
  searchQuery: string,
  objectType: "MOVIE" | "SHOW"
): Promise<SearchNode[]> {
  const data = await graphql<{ popularTitles?: { edges?: Array<{ node?: SearchNode }> } }>(
    token,
    SEARCH_QUERY,
    { filter: { searchQuery, objectTypes: [objectType] }, country, language, first: 5 },
    country,
    language
  );
  return (data.popularTitles?.edges ?? []).map((e) => e.node).filter((n): n is SearchNode => n != null && Boolean(n.id));
}

export async function showSeasons(
  token: TokenFile,
  country: string,
  language: string,
  showId: string
): Promise<SeasonNode[]> {
  const data = await graphql<{ node?: { seasons?: SeasonNode[] } }>(
    token,
    SHOW_QUERY,
    { nodeId: showId, country, language },
    country,
    language
  );
  return data.node?.seasons ?? [];
}

export async function setSeen(
  token: TokenFile,
  country: string,
  language: string,
  id: string
): Promise<string | null> {
  const data = await graphql<{ setInSeenlist?: { title?: { id?: string } } }>(
    token,
    SET_SEEN_MUTATION,
    { input: { id, state: true, country } },
    country,
    language
  );
  return data.setInSeenlist?.title?.id ?? id;
}
