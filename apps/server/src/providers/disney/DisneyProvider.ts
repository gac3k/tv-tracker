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
import { buildObservation, DISNEY_PARSER_VERSION, type DisneyTileRaw } from "./parser";

const DISNEY_HOME = "https://www.disneyplus.com";
const log = logger.child({ provider: "disney" });

/**
 * Disney+ has no account-side viewing-history API (UTS treats it as a DOM
 * scrobbler). We scrape the "Continue Watching" set from the home page and emit
 * `continue_watching` observations. This is the most fragile adapter and has
 * not been verified against a live Disney+ account in development — selectors
 * are best-effort; use `--save-fixture` to capture real markup and tune them.
 */
@ContentProvider({
  id: "disney",
  label: "Disney+",
  auth: "browser",
  fields: [],
  parserVersion: DISNEY_PARSER_VERSION,
  loginUrl: `${DISNEY_HOME}/login`,
})
export class DisneyProvider implements VodProvider {
  readonly name = "disney" as const;

  async login(): Promise<void> {
    await runInteractiveLogin(this.name, `${DISNEY_HOME}/login`, async (page) => {
      const authed = await this.isSignedIn(page);
      return authed ? "" : null; // Disney+ profile name is not reliably in the DOM
    });
  }

  private async isSignedIn(page: Page): Promise<boolean> {
    // Signed-in home renders content tiles under /home or /browse; signed-out
    // redirects to /login or shows a login/subscribe form.
    return page.evaluate(() => {
      const url = location.href;
      if (/\/login|\/welcome|\/begin/.test(url)) return false;
      const hasTiles =
        document.querySelector('a[href*="/video/"], a[href*="/play/"], a[href*="/browse/entity-"]') != null;
      return hasTiles;
    });
  }

  private async openHome(page: Page): Promise<void> {
    try {
      await page.goto(`${DISNEY_HOME}/home`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      throw new ProviderNetworkError("disney", "Failed to load disneyplus.com", { cause: err });
    }
    await page
      .waitForSelector('a[href*="/video/"], a[href*="/play/"], a[href*="/browse/entity-"]', {
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

  /** Scrape the "Continue Watching" set. Selectors verified on the live web app. */
  private async scrape(page: Page): Promise<DisneyTileRaw[]> {
    return page.evaluate(() => {
      const results: {
        id: string;
        remainingText?: string;
        showText?: string;
        episodeText?: string;
        ariaLabel?: string;
      }[] = [];
      const seen = new Set<string>();

      // Each Continue Watching tile pairs a playable `set-item` anchor with a
      // `cw-set-item-metadata` anchor under one parent. The cw- testid is
      // unique to the Continue Watching shelf.
      const metadataAnchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[data-testid="cw-set-item-metadata"]')
      );
      for (const meta of metadataAnchors) {
        // The set-item anchor is not a direct sibling — climb to the nearest
        // ancestor that contains both anchors of the tile pair.
        let pair: HTMLElement | null = meta.parentElement;
        for (let i = 0; i < 5 && pair && !pair.querySelector('a[data-testid="set-item"]'); i++) {
          pair = pair.parentElement;
        }
        const tile = pair?.querySelector<HTMLAnchorElement>('a[data-testid="set-item"]');
        const id =
          tile?.getAttribute("data-item-id") ??
          /\/play\/(?<id>[a-z0-9-]{10,})/i.exec(tile?.getAttribute("href") ?? "")?.groups?.id;
        if (!id || seen.has(id)) continue;

        // Metadata divs, in order: time remaining, show/title, episode line
        // ("S2:O22 Episode Title", shares its div with the rating badge image —
        // img alt does not leak into textContent). Episode line is absent for movies.
        const divs = Array.from(meta.querySelectorAll<HTMLElement>(":scope > div"));
        const texts = divs.map((d) => d.textContent?.trim() ?? "").filter(Boolean);
        const remainingText = texts.find((t) => /\d\s*(?:m|h|godz)/i.test(t));
        const episodeIndex = texts.findIndex((t) => /\bS\d+\s*:/.test(t));
        const episodeText = episodeIndex >= 0 ? texts[episodeIndex] : undefined;
        // The show name is the line directly above the episode line. Taking the
        // "first other line" instead picks up action labels ("Watch next episode").
        const showText =
          (episodeIndex > 0 ? texts[episodeIndex - 1] : undefined) ??
          texts.find((t) => t !== remainingText && t !== episodeText);

        seen.add(id);
        results.push({
          id,
          remainingText,
          showText,
          episodeText,
          ariaLabel: tile?.getAttribute("aria-label") ?? undefined,
        });
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
          "disney",
          "Not signed in to Disney+ in the persisted browser session. Run: pnpm cli login disney"
        );
      }

      // The Continue Watching shelf lazy-loads: skeleton anchors carry the
      // testid before any content. Wait until at least one metadata anchor has
      // real text (digits from the time-remaining line) and a playable tile id.
      await page
        .waitForFunction(
          () =>
            document.querySelector('a[data-testid="set-item"][data-item-id]') != null &&
            Array.from(
              document.querySelectorAll('a[data-testid="cw-set-item-metadata"]')
            ).some((m) => /\d/.test(m.textContent ?? "")),
          undefined,
          { timeout: 25_000 }
        )
        .catch(() => undefined);
      const raw = await this.scrape(page);
      if (options.saveFixture) {
        this.saveFixture(raw);
      }

      const observedAt = new Date();
      const observations = raw.map((tile) => buildObservation(tile, observedAt));
      log.info({ observations: observations.length }, "disney continue-watching scraped");
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
