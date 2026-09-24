/**
 * Prime Video private-API access via Playwright's request context (cookies from
 * the persistent profile; APIRequestContext is not subject to CORS, which the
 * cross-origin atv-ps.* endpoints would otherwise trigger).
 *
 * Endpoint URLs, parameters and the region-resolution logic are derived from
 * Universal Trakt Scrobbler src/services/amazon-prime/AmazonPrimeApi.ts
 * (MIT License, Copyright (c) 2020 trakt-tools). See NOTICE.
 */
import type { BrowserContext } from "playwright";
import {
  ProviderApiChangedError,
  ProviderAuthenticationError,
  ProviderNetworkError,
  ProviderRateLimitError,
} from "../errors";
import type {
  PrimeConfigResponse,
  PrimeEnrichmentsResponse,
  PrimeHistoryResponse,
  PrimeMetadataItem,
  PrimeProfileResponse,
} from "./types";

export const PRIME_HOME = "https://www.primevideo.com";
/**
 * Watch history is an account-settings page. A Prime playback session (getProfiles)
 * can be valid while this page still redirects to the marketplace sign-in, and the
 * history API then answers HTTP 403 with a "page not found" shell.
 */
export const PRIME_HISTORY_PAGE = `${PRIME_HOME}/settings/watch-history`;

/** Stable random UUID v4 identifying this client, same idea as UTS. */
const DEVICE_ID = "b7c8e1f2-4a6d-4e2b-9c3f-8d5a7e901b24";
/** Desktop web device type, captured from network requests by UTS. */
const DEVICE_TYPE_ID = "AOAGZA014O5RE";

const HEADERS = { "x-requested-with": "XMLHttpRequest" };

export interface PrimeEndpoints {
  hostUrl: string;
  apiUrl: string;
  profileUrl: string;
  historyUrl: (nextToken: string | null) => string;
  enrichmentsUrl: (ids: string[]) => string;
  metadataUrl: (id: string) => string;
}

async function getJson<T>(
  context: BrowserContext,
  url: string,
  what: string
): Promise<T> {
  let status: number;
  let body: string;
  try {
    const res = await context.request.get(url, { headers: HEADERS });
    status = res.status();
    body = await res.text();
  } catch (err) {
    throw new ProviderNetworkError("prime", `${what} request failed`, { cause: err });
  }
  if (status === 401 || status === 403) {
    const message =
      status === 403 && what === "History endpoint"
        ? "History endpoint returned HTTP 403. Prime Video playback login cannot open watch history — finish the Amazon account sign-in on the watch history page (pnpm cli login prime)."
        : `${what} returned HTTP ${status} — login expired?`;
    throw new ProviderAuthenticationError("prime", message);
  }
  if (status === 429) {
    throw new ProviderRateLimitError("prime", `${what} rate limited (HTTP 429)`);
  }
  if (status >= 400) {
    throw new ProviderApiChangedError("prime", `${what} returned HTTP ${status} — API may have changed`);
  }
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    // Amazon redirects unauthenticated API calls to HTML login pages.
    if (/<html|<!doctype/i.test(body.slice(0, 200))) {
      throw new ProviderAuthenticationError(
        "prime",
        `${what} returned an HTML page instead of JSON — login expired?`
      );
    }
    throw new ProviderApiChangedError("prime", `${what} response is not JSON — API may have changed`, {
      cause: err,
    });
  }
}

/**
 * Resolve region-specific endpoints from GetAppStartupConfig. The API host is
 * atv-ps.primevideo.com for NA, atv-ps-<region>.primevideo.com otherwise; the
 * website API path differs between amazon.* and primevideo.com territories.
 */
export async function resolveEndpoints(context: BrowserContext): Promise<PrimeEndpoints> {
  const configUrl =
    `https://atv-ps.primevideo.com/cdp/usage/GetAppStartupConfig` +
    `?deviceID=&deviceTypeID=${DEVICE_TYPE_ID}&firmware=1&gascEnabled=false&version=1`;
  const config = await getJson<PrimeConfigResponse>(context, configUrl, "Startup config");

  const region = config.customerConfig?.homeRegion?.toLowerCase();
  const hostUrl = config.territoryConfig?.defaultVideoWebsite;
  if (!region || !hostUrl) {
    throw new ProviderApiChangedError(
      "prime",
      "Expected `customerConfig.homeRegion` / `territoryConfig.defaultVideoWebsite` in startup config. " +
        "Provider API may have changed."
    );
  }

  const apiUrl = hostUrl
    .replace("www.", "")
    .replace("//", `//atv-ps${region === "na" ? "" : `-${region}`}.`);
  const apiPath = /https:\/\/(?:www\.)?amazon\..+/.test(hostUrl)
    ? "/gp/video/api"
    : `/region/${region}/api`;

  return {
    hostUrl,
    apiUrl,
    profileUrl: `${hostUrl}${apiPath}/getProfiles`,
    historyUrl: (nextToken) =>
      `${hostUrl}${apiPath}/getWatchHistorySettingsPage?widgetArgs=%7B${
        nextToken ? `%22nextToken%22%3A%22${encodeURIComponent(nextToken)}%22` : ""
      }%7D`,
    enrichmentsUrl: (ids) =>
      `${hostUrl}${apiPath}/enrichItemMetadata?metadataToEnrich=%7B%22playback%22%3Atrue%7D` +
      `&titleIDsToEnrich=%5B${ids.map((id) => `%22${encodeURIComponent(id)}%22`).join("%2C")}%5D`,
    metadataUrl: (id) =>
      `${apiUrl}/cdp/catalog/GetPlaybackResources?asin=${encodeURIComponent(id)}` +
      `&consumptionType=Streaming&desiredResources=CatalogMetadata&deviceID=${DEVICE_ID}` +
      `&deviceTypeID=${DEVICE_TYPE_ID}&firmware=1&gascEnabled=true&resourceUsage=CacheResources` +
      `&videoMaterialType=Feature&titleDecorationScheme=primary-content&uxLocale=en_US`,
  };
}

/** Returns the selected profile, or null when the session is not authenticated. */
export async function fetchSelectedProfile(
  context: BrowserContext,
  endpoints: PrimeEndpoints
): Promise<{ id: string; name: string } | null> {
  try {
    const response = await getJson<PrimeProfileResponse>(
      context,
      endpoints.profileUrl,
      "Profiles endpoint"
    );
    const profile = response.profiles?.find((p) => p.isSelected);
    return profile ? { id: profile.id, name: profile.name } : null;
  } catch (err) {
    if (err instanceof ProviderAuthenticationError) {
      return null;
    }
    throw err;
  }
}

/** True when the session can read watch history, not merely a Prime playback profile. */
export async function canReadHistory(
  context: BrowserContext,
  endpoints: PrimeEndpoints
): Promise<boolean> {
  try {
    await fetchHistoryPage(context, endpoints, null);
    return true;
  } catch (err) {
    if (err instanceof ProviderAuthenticationError) return false;
    throw err;
  }
}

export async function fetchHistoryPage(
  context: BrowserContext,
  endpoints: PrimeEndpoints,
  nextToken: string | null
): Promise<{ response: PrimeHistoryResponse; nextToken: string | null }> {
  const response = await getJson<PrimeHistoryResponse>(
    context,
    endpoints.historyUrl(nextToken),
    "History endpoint"
  );
  if (!Array.isArray(response.widgets)) {
    throw new ProviderApiChangedError(
      "prime",
      "Expected `widgets` array in history response but it is missing. Provider API may have changed."
    );
  }
  const widget = response.widgets.find((w) => w.widgetType === "watch-history");
  const content = widget?.content.content;
  const token = content && "titles" in content ? (content.nextToken ?? null) : null;
  return { response, nextToken: token };
}

export async function fetchEnrichments(
  context: BrowserContext,
  endpoints: PrimeEndpoints,
  ids: string[]
): Promise<PrimeEnrichmentsResponse> {
  if (ids.length === 0) {
    return { enrichments: {} };
  }
  return getJson<PrimeEnrichmentsResponse>(
    context,
    endpoints.enrichmentsUrl(ids),
    "Enrichments endpoint"
  );
}

/** Metadata for one title; null when unavailable (history stays usable without it). */
export async function fetchMetadata(
  context: BrowserContext,
  endpoints: PrimeEndpoints,
  id: string
): Promise<PrimeMetadataItem | null> {
  try {
    const metadata = await getJson<PrimeMetadataItem>(
      context,
      endpoints.metadataUrl(id),
      "Metadata endpoint"
    );
    return metadata?.catalogMetadata ? metadata : null;
  } catch {
    return null;
  }
}
