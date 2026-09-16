import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { applyImportedCookies } from "./cookies";
import { config } from "../config";
import { logger } from "../logger";
import { BrowserProfileBusyError, ProviderError } from "../providers/errors";
import type { ProviderName } from "../providers/provider";

/** Find a system-installed Chromium as fallback (e.g. NixOS, where the
 * Playwright-downloaded binary cannot load FHS shared libraries). */
function findSystemChromium(): string | null {
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const path = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (path) return path;
    } catch {
      // not found, try next
    }
  }
  return null;
}

let resolvedExecutablePath: string | null | undefined;

function launchOptions(headless: boolean) {
  return {
    headless,
    viewport: headless ? ({ width: 1280, height: 720 } as const) : null,
    executablePath: resolvedExecutablePath ?? undefined,
  };
}

/**
 * Persistent Chromium profiles, one directory per provider
 * (.data/browser/<provider>). The profile directory IS the credential:
 * it holds cookies and login state. Never expose it over HTTP.
 */
export async function openBrowserContext(
  provider: ProviderName,
  opts: { headless: boolean }
): Promise<BrowserContext> {
  const profileDir = config.browserProfileDir(provider);
  fs.mkdirSync(profileDir, { recursive: true });
  if (resolvedExecutablePath === undefined) {
    resolvedExecutablePath = process.env.BROWSER_EXECUTABLE_PATH ?? null;
  }
  try {
    const context = await chromium.launchPersistentContext(profileDir, launchOptions(opts.headless));
    // tsx/esbuild keepNames injects __name() into serialized page.evaluate() callbacks.
    await context.addInitScript("globalThis.__name ??= (f) => f");
    const imported = await applyImportedCookies(context, provider);
    if (imported) {
      logger.info({ provider, imported: imported }, "applied imported browser session");
    }
    return context;
    // Chromium refuses to run two processes on one profile dir, which is
    // exactly what we want: sync cannot run while interactive login is open.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ProcessSingleton|SingletonLock|profile is already in use/i.test(message)) {
      throw new BrowserProfileBusyError(
        provider,
        `Browser profile for ${provider} is in use (interactive login open?). Close it and retry.`,
        { cause: err }
      );
    }
    // Playwright-bundled Chromium cannot start (missing shared libraries on
    // non-FHS distros like NixOS) — fall back to a system-installed browser.
    if (
      resolvedExecutablePath === null &&
      /error while loading shared libraries|Executable doesn't exist/i.test(message)
    ) {
      const systemBrowser = findSystemChromium();
      if (systemBrowser) {
        logger.warn(
          { executablePath: systemBrowser },
          "Playwright-bundled Chromium failed to start; falling back to system browser"
        );
        resolvedExecutablePath = systemBrowser;
        return openBrowserContext(provider, opts);
      }
      throw new ProviderError(
        provider,
        "No usable Chromium: the Playwright-bundled binary cannot start and no system " +
          "chromium/google-chrome was found. Install one or set BROWSER_EXECUTABLE_PATH.",
        { cause: err }
      );
    }
    throw err;
  }
}
