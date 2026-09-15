import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { config } from "../../config";
import { logger } from "../../logger";
import { openBrowserContext } from "../../browser/session";
import { runInteractiveLogin } from "../../browser/loginFlow";
import { redact } from "../../utils/redact";
import { ProviderAuthenticationError, ProviderNetworkError } from "../errors";
import type {
  PlaybackObservation,
  ProviderStatus,
  SyncOptions,
  VodProvider,
} from "../provider";
import { ContentProvider } from "../decorate";
import { APPLE_PARSER_VERSION, buildObservation, type AppleUpNextRaw } from "./parser";

const APPLE_HOME = "https://tv.apple.com";
const log = logger.child({ provider: "apple" });

/**
 * Apple TV has no account-side history API (UTS marks it hasSync:false). The
 * "Up Next" / Continue Watching shelf is the next (or in-progress) episode;
 * E9 on the shelf means E8 was finished. Played-% comes from `.progress-track`.
 */
@ContentProvider({
  id: "apple",
  label: "Apple TV",
  auth: "browser",
  fields: [],
  parserVersion: APPLE_PARSER_VERSION,
  loginUrl: APPLE_HOME,
})
export class AppleProvider implements VodProvider {
  readonly name = "apple" as const;

  async login(): Promise<void> {
    await runInteractiveLogin(this.name, `${APPLE_HOME}/`, async (page) => {
      const authed = await this.isSignedIn(page);
      return authed ? "" : null; // Apple shows no profile name on the web
    });
  }

  private async isSignedIn(page: Page): Promise<boolean> {
    // A signed-in account renders an account menu button; signed-out shows "Sign In".
    return page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      const hasAccountButton =
        document.querySelector('[aria-label*="Account" i], [data-metrics-location*="account" i]') != null;
      const looksSignedOut = /\bsign in\b/.test(text) && !hasAccountButton;
      return hasAccountButton || !looksSignedOut;
    });
  }

  private async openHome(page: Page): Promise<void> {
    try {
      await page.goto(`${APPLE_HOME}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      throw new ProviderNetworkError("apple", "Failed to load tv.apple.com", { cause: err });
    }
    // The Continue Watching shelf hydrates client-side.
    await page
      .waitForSelector('[data-testid="continue-watching-lockup"], a[href*="umc.cmc"]', {
        timeout: 15_000,
      })
      .catch(() => undefined);
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await this.openHome(page);
      return { authenticated: await this.isSignedIn(page) };
    } finally {
      await context.close();
    }
  }

  /** Scrape the "Continue Watching" shelf: content id, route type, label, progress bar. */
  private async scrape(page: Page): Promise<AppleUpNextRaw[]> {
    // Runs in the browser; AppleUpNextRaw is not in scope there, hence the inline shape.
    return page.evaluate(() => {
      const results: {
        id: string;
        routeType: string;
        label: string;
        trackStyle?: string;
        trackAria?: string;
        fillPx?: number;
        trackPx?: number;
      }[] = [];
      const seen = new Set<string>();
      const idRegex = /\/(?<type>movie|episode|show)\/[^/?#]+\/(?<id>umc\.cmc\.[^/?#]+)/;

      let lockups = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[data-testid="continue-watching-lockup"]')
      );
      if (lockups.length === 0) {
        let heading: Element | undefined;
        for (const h of Array.from(document.querySelectorAll("h2, h3, [role=heading]"))) {
          if (/continue watching/i.test(h.textContent ?? "")) {
            heading = h;
            break;
          }
        }
        const shelf = heading?.closest("section, [class*='shelf']") ?? undefined;
        lockups = shelf
          ? Array.from(shelf.querySelectorAll<HTMLAnchorElement>('a[href*="umc.cmc"]'))
          : [];
      }

      for (const anchor of lockups) {
        const match = idRegex.exec(anchor.getAttribute("href") ?? "");
        const id = match?.groups?.id;
        const routeType = match?.groups?.type;
        if (!id || !routeType || seen.has(id)) continue;

        const label =
          anchor.querySelector(".visually-hidden")?.textContent?.trim() ||
          anchor.getAttribute("aria-label")?.trim() ||
          anchor.querySelector<HTMLImageElement>("img[alt]")?.alt?.trim() ||
          anchor.textContent?.trim() ||
          "";

        seen.add(id);
        // Inline: named functions inside page.evaluate break under tsx (esbuild injects __name).
        let track: HTMLElement | null = anchor.querySelector<HTMLElement>(".progress-track");
        if (!track) {
          const tile = anchor.closest("li") ?? anchor.parentElement;
          if (tile && tile !== anchor) {
            const lockupsInTile = tile.querySelectorAll(
              'a[data-testid="continue-watching-lockup"], a[href*="umc.cmc"]'
            );
            if (lockupsInTile.length > 1) {
              let sib = anchor.nextElementSibling;
              while (
                sib &&
                !sib.matches("a[href*='umc.cmc'], a[data-testid='continue-watching-lockup']")
              ) {
                if (sib.classList.contains("progress-track")) {
                  track = sib as HTMLElement;
                  break;
                }
                const nested = sib.querySelector<HTMLElement>(".progress-track");
                if (nested) {
                  track = nested;
                  break;
                }
                sib = sib.nextElementSibling;
              }
            } else {
              track = tile.querySelector<HTMLElement>(".progress-track");
            }
          }
        }
        const fill = (track?.firstElementChild as HTMLElement | null) ?? track;
        const entry: (typeof results)[number] = { id, routeType, label };
        if (track && fill) {
          entry.trackStyle = fill.getAttribute("style") ?? track.getAttribute("style") ?? undefined;
          entry.trackAria =
            track.getAttribute("aria-valuenow") ?? fill.getAttribute("aria-valuenow") ?? undefined;
          const fillRect = fill.getBoundingClientRect();
          const trackRect = track.getBoundingClientRect();
          if (fillRect.width >= 0) entry.fillPx = fillRect.width;
          if (trackRect.width > 0) entry.trackPx = trackRect.width;
        }
        results.push(entry);
      }
      return results;
    });
  }

  async sync(options: SyncOptions = {}): Promise<PlaybackObservation[]> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await this.openHome(page);
      if (!(await this.isSignedIn(page))) {
        throw new ProviderAuthenticationError(
          "apple",
          "Not signed in to Apple TV in the persisted browser session. Run: pnpm cli login apple"
        );
      }

      const raw = await this.scrape(page);
      if (options.saveFixture) {
        this.saveFixture(raw);
      }

      const observedAt = new Date();
      const observations = raw.map((entry) => buildObservation(entry, observedAt));
      log.info({ observations: observations.length }, "apple up-next scraped");
      return observations;
    } finally {
      await context.close();
    }
  }

  private saveFixture(data: unknown): void {
    const dir = config.fixturesDir(this.name);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `sync-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(redact(data), null, 2));
    log.info({ file }, "sanitized fixture saved");
  }
}
