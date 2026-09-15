/**
 * Max data access by intercepting the web app's own authenticated responses.
 *
 * The modern Max web client authenticates its API calls with cookies + custom
 * `disco_*` headers that we cannot easily reproduce from an out-of-page request
 * (a direct call returns `disco_client is missing`). So instead of calling the
 * API ourselves, we load the home page and capture the responses the app makes:
 * `/users/me/profiles` (auth + profile name) and the "Continue Watching"
 * collection (the viewing signal).
 */
import type { BrowserContext, Page, Response } from "playwright";
import { ProviderNetworkError } from "../errors";
import type {
  MaxCapturedSession,
  MaxCollectionResponse,
  MaxProfilesResponse,
} from "./types";

export const MAX_HOME = "https://play.hbomax.com";

function isContinueWatching(json: unknown): json is MaxCollectionResponse {
  const alias = (json as MaxCollectionResponse)?.data?.attributes?.alias;
  return typeof alias === "string" && alias.includes("continue-watching");
}

/**
 * Load the Max home page and capture the profiles + Continue Watching responses
 * the app fetches. Resolves once profiles are seen (auth signal) or times out.
 */
export async function captureHomeSession(
  context: BrowserContext,
  page: Page,
  { timeoutMs = 20_000 } = {}
): Promise<MaxCapturedSession> {
  let profileName: string | null = null;
  let profilesSeen = false;
  let continueWatching: MaxCollectionResponse | null = null;

  const onResponse = (res: Response): void => {
    const url = res.url();
    if (res.request().method() !== "GET" || res.status() !== 200) return;
    if (/\/users\/me\/profiles/.test(url)) {
      void res
        .json()
        .then((json: MaxProfilesResponse) => {
          profilesSeen = true;
          const profiles = json?.data ?? [];
          const chosen = profiles.find((p) => p.attributes?.isDefault) ?? profiles[0];
          profileName = chosen?.attributes?.profileName ?? null;
        })
        .catch(() => undefined);
    } else if (/\/cms\/collections\//.test(url)) {
      void res
        .json()
        .then((json) => {
          if (isContinueWatching(json)) {
            continueWatching = json;
          }
        })
        .catch(() => undefined);
    }
  };

  context.on("response", onResponse);
  try {
    await page.goto(`${MAX_HOME}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (err) {
    context.off("response", onResponse);
    throw new ProviderNetworkError("max", "Failed to load play.hbomax.com", { cause: err });
  }

  // Poll until we have the profiles signal (and give Continue Watching a chance
  // to arrive too), or until the timeout.
  const deadline = Date.now() + timeoutMs;
  // Date.now is allowed here (not inside a workflow script).
  while (Date.now() < deadline) {
    if (profilesSeen && continueWatching) break;
    await page.waitForTimeout(500);
  }
  context.off("response", onResponse);

  return { profileName, continueWatching };
}
