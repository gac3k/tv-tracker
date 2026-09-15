import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import { logger } from "../../logger";
import { openBrowserContext } from "../../browser/session";
import { runInteractiveLogin } from "../../browser/loginFlow";
import { redact } from "../../utils/redact";
import { ProviderAuthenticationError } from "../errors";
import type {
  PlaybackObservation,
  ProviderStatus,
  SyncOptions,
  VodProvider,
} from "../provider";
import { ContentProvider } from "../decorate";
import {
  fetchHistoryPage,
  fetchSingleMetadata,
  NETFLIX_HOME,
  openNetflixPage,
  readSession,
} from "./api";
import { metadataIdFor, NETFLIX_PARSER_VERSION, parseHistoryItem } from "./parser";
import type { NetflixHistoryItem, NetflixSingleMetadataItem } from "./types";

const log = logger.child({ provider: "netflix" });

@ContentProvider({
  id: "netflix",
  label: "Netflix",
  auth: "browser",
  fields: [],
  parserVersion: NETFLIX_PARSER_VERSION,
  loginUrl: `${NETFLIX_HOME}/login`,
})
export class NetflixProvider implements VodProvider {
  readonly name = "netflix" as const;

  async login(): Promise<void> {
    await runInteractiveLogin(this.name, `${NETFLIX_HOME}/login`, async (page) => {
      const session = await readSession(page);
      return session?.profileName ?? null;
    });
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openNetflixPage(page);
      const session = await readSession(page);
      return {
        authenticated: session?.profileName != null,
        profileName: session?.profileName ?? undefined,
      };
    } finally {
      await context.close();
    }
  }

  async sync(options: SyncOptions = {}): Promise<PlaybackObservation[]> {
    const pages = options.pages ?? config.SYNC_PAGES;
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openNetflixPage(page);
      const session = await readSession(page);
      if (!session?.profileName || !session.userGuid) {
        throw new ProviderAuthenticationError(
          "netflix",
          "No authenticated Netflix profile in the persisted browser session. Run: pnpm cli login netflix"
        );
      }
      log.debug({ profile: session.profileName }, "session active");

      // 1. Fetch history pages.
      const items: NetflixHistoryItem[] = [];
      const rawPages: unknown[] = [];
      for (let i = 0; i < pages; i++) {
        const { items: pageItems, rawResponse } = await fetchHistoryPage(page, session.userGuid, i);
        log.debug({ page: i, count: pageItems.length }, "history page fetched");
        rawPages.push(rawResponse);
        items.push(...pageItems);
        if (pageItems.length === 0) {
          break; // end of history
        }
      }

      // 2. Fetch metadata once per unique show/movie id.
      const metadataById = new Map<number, NetflixSingleMetadataItem | null>();
      const urlTemplateCache = { template: null as string | null };
      let metadataFailures = 0;
      for (const item of items) {
        const id = metadataIdFor(item);
        if (metadataById.has(id)) continue;
        const metadata = await fetchSingleMetadata(page, String(id), session, urlTemplateCache);
        metadataById.set(id, metadata);
        if (!metadata && !urlTemplateCache.template) {
          metadataFailures += 1;
          if (metadataFailures >= 2) {
            // No URL variation works at all — stop probing, keep history without metadata.
            log.warn("No Netflix metadata endpoint variation works; syncing without season/episode numbers");
            break;
          }
        }
      }

      if (options.saveFixture) {
        this.saveFixture(rawPages, [...metadataById.values()].filter(Boolean));
      }

      // 3. Parse into normalized observations.
      const observedAt = new Date();
      const observations = items.map((item) =>
        parseHistoryItem(item, metadataById.get(metadataIdFor(item)) ?? null, observedAt)
      );
      for (const obs of observations) {
        obs.profileId = session.userGuid;
      }
      log.info({ observations: observations.length }, "netflix sync fetched");
      return observations;
    } finally {
      await context.close();
    }
  }

  private saveFixture(historyPages: unknown[], metadata: unknown[]): void {
    const dir = config.fixturesDir(this.name);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `sync-${stamp}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(redact({ historyPages, metadata }), null, 2)
    );
    log.info({ file }, "sanitized fixture saved");
  }
}
