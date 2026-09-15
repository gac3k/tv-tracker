/**
 * Netflix private-API access, executed inside an authenticated Playwright page
 * so cookies/origin/referer are handled by the browser itself.
 *
 * Endpoint URLs, request format and fallback order are derived from
 * Universal Trakt Scrobbler src/services/netflix/NetflixApi.ts
 * (MIT License, Copyright (c) 2020 trakt-tools). See NOTICE.
 */
import type { Page } from "playwright";
import {
  ProviderApiChangedError,
  ProviderAuthenticationError,
  ProviderNetworkError,
  ProviderRateLimitError,
} from "../errors";
import type {
  NetflixAuiHistoryResponse,
  NetflixHistoryItem,
  NetflixSession,
  NetflixSingleMetadataItem,
} from "./types";

export const NETFLIX_HOME = "https://www.netflix.com";
const HISTORY_PAGE_SIZE = 50;

/** Navigate to Netflix and wait for the SPA globals to appear. */
export async function openNetflixPage(page: Page): Promise<void> {
  try {
    await page.goto(`${NETFLIX_HOME}/browse`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (err) {
    throw new ProviderNetworkError("netflix", "Failed to load netflix.com", { cause: err });
  }
  // reactContext is inlined in the HTML; give the SPA a moment on slow loads.
  await page
    .waitForFunction(() => (window as any).netflix?.reactContext != null, undefined, {
      timeout: 15_000,
    })
    .catch(() => undefined);
}

/** Read session info from the page global (adapted from UTS injected function). */
export async function readSession(page: Page): Promise<NetflixSession | null> {
  return page.evaluate(() => {
    const netflix = (window as any).netflix;
    const data = netflix?.reactContext?.models?.userInfo?.data;
    if (!data?.authURL) {
      return null;
    }
    return {
      authUrl: data.authURL as string,
      profileName: (data.name ?? null) as string | null,
      userGuid: data.userGuid as string | undefined,
      buildIdentifier: netflix?.reactContext?.models?.serverDefs?.data?.BUILD_IDENTIFIER as
        | string
        | undefined,
    };
  });
}

interface InPageFetchResult {
  status: number;
  body: string;
}

function checkStatus(status: number, what: string): void {
  if (status === 401 || status === 403) {
    throw new ProviderAuthenticationError("netflix", `${what} returned HTTP ${status} — login expired?`);
  }
  if (status === 429) {
    throw new ProviderRateLimitError("netflix", `${what} rate limited (HTTP 429)`);
  }
  if (status >= 400) {
    throw new ProviderApiChangedError("netflix", `${what} returned HTTP ${status} — API may have changed`);
  }
}

/**
 * Fetch one page of viewing history via the falcor pathEvaluator endpoint.
 * Returns the raw parsed JSON response plus the extracted items.
 */
export async function fetchHistoryPage(
  page: Page,
  userGuid: string,
  pageIndex: number,
  pageSize = HISTORY_PAGE_SIZE
): Promise<{ items: NetflixHistoryItem[]; rawResponse: unknown }> {
  let result: InPageFetchResult;
  try {
    result = await page.evaluate(
      async ({ pageIndex, pageSize, userGuid }) => {
        const callPath = `["aui","viewingActivity",${pageIndex},${pageSize}]`;
        const url =
          `/api/aui/pathEvaluator/web/%5E2.0.0?method=call` +
          `&callPath=${encodeURIComponent(callPath)}&falcor_server=0.1.0`;
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-netflix.request.routing":
              '{"path":"/nq/aui/endpoint/%5E1.0.0-web/pathEvaluator","control_tag":"auinqweb"}',
          },
          body: `param=${encodeURIComponent(JSON.stringify({ guid: userGuid }))}`,
        });
        return { status: res.status, body: await res.text() };
      },
      { pageIndex, pageSize, userGuid }
    );
  } catch (err) {
    throw new ProviderNetworkError("netflix", "History request failed in browser context", {
      cause: err,
    });
  }

  checkStatus(result.status, "History endpoint");

  let json: NetflixAuiHistoryResponse;
  try {
    json = JSON.parse(result.body) as NetflixAuiHistoryResponse;
  } catch (err) {
    throw new ProviderApiChangedError("netflix", "History response is not JSON — API may have changed", {
      cause: err,
    });
  }

  const activity = json.jsonGraph?.aui?.viewingActivity;
  if (activity === undefined) {
    throw new ProviderApiChangedError(
      "netflix",
      "Expected `jsonGraph.aui.viewingActivity` but field is missing. Provider API may have changed."
    );
  }
  return { items: activity.value?.viewedItems ?? [], rawResponse: json };
}

/**
 * Fetch metadata for one show/movie id. Tries the memberapi URL variations in
 * the same order as UTS; the first working template is cached by the caller.
 * Returns null when no variation works (metadata is optional — history still usable).
 */
export async function fetchSingleMetadata(
  page: Page,
  id: string,
  session: NetflixSession,
  urlTemplateCache: { template: string | null }
): Promise<NetflixSingleMetadataItem | null> {
  const baseUrls = [`/nq/website/memberapi/release`];
  if (session.buildIdentifier) {
    baseUrls.push(`/nq/website/memberapi/${session.buildIdentifier}`);
    baseUrls.push(`/api/shakti/${session.buildIdentifier}`);
  }
  baseUrls.push(`/api/shakti/mre`);

  const templates = baseUrls.flatMap((base) => [
    `${base}/metadata?languages=en-US&movieid={id}`,
    `${base}/metadata?languages=en-US&movieid={id}&authURL=${encodeURIComponent(session.authUrl)}`,
  ]);
  if (urlTemplateCache.template) {
    templates.unshift(urlTemplateCache.template);
  }

  for (const template of templates) {
    try {
      const result: InPageFetchResult = await page.evaluate(
        async (url: string) => {
          const res = await fetch(url, { method: "GET", credentials: "include" });
          return { status: res.status, body: await res.text() };
        },
        template.replace("{id}", id)
      );
      if (result.status >= 400) {
        continue;
      }
      const metadata = JSON.parse(result.body) as NetflixSingleMetadataItem;
      if (metadata?.video) {
        urlTemplateCache.template = template;
        return metadata;
      }
    } catch {
      // Try the next URL variation.
    }
  }
  return null;
}
