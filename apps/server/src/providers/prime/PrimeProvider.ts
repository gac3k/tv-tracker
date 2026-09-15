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
import {
  fetchEnrichments,
  fetchHistoryPage,
  fetchMetadata,
  fetchSelectedProfile,
  PRIME_HOME,
  resolveEndpoints,
} from "./api";
import { ContentProvider } from "../decorate";
import { buildObservation, extractHistoryEntries, PRIME_PARSER_VERSION } from "./parser";
import type { PrimeMetadataItem } from "./types";

const log = logger.child({ provider: "prime" });

@ContentProvider({
  id: "prime",
  label: "Prime Video",
  auth: "browser",
  fields: [],
  parserVersion: PRIME_PARSER_VERSION,
  loginUrl: PRIME_HOME,
})
export class PrimeProvider implements VodProvider {
  readonly name = "prime" as const;

  async login(): Promise<void> {
    await runInteractiveLogin(this.name, PRIME_HOME, async (page) => {
      // API probe works cookie-based; no page globals needed.
      const endpoints = await resolveEndpoints(page.context());
      const profile = await fetchSelectedProfile(page.context(), endpoints);
      return profile?.name ?? null;
    });
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      // Cookie-based API probe; no page navigation required.
      const endpoints = await resolveEndpoints(context);
      const profile = await fetchSelectedProfile(context, endpoints);
      return { authenticated: profile != null, profileName: profile?.name };
    } finally {
      await context.close();
    }
  }

  async sync(options: SyncOptions = {}): Promise<PlaybackObservation[]> {
    const pages = options.pages ?? config.SYNC_PAGES;
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const endpoints = await resolveEndpoints(context);
      const profile = await fetchSelectedProfile(context, endpoints);
      if (!profile) {
        throw new ProviderAuthenticationError(
          "prime",
          "No authenticated Prime Video profile in the persisted browser session. Run: pnpm cli login prime"
        );
      }
      log.debug({ profile: profile.name }, "session active");

      // 1. Fetch history pages (token-paginated).
      const rawPages: unknown[] = [];
      const entries = [];
      let nextToken: string | null = null;
      for (let i = 0; i < pages; i++) {
        const page = await fetchHistoryPage(context, endpoints, nextToken);
        rawPages.push(page.response);
        const pageEntries = extractHistoryEntries(page.response);
        entries.push(...pageEntries);
        log.debug({ page: i, count: pageEntries.length }, "history page fetched");
        nextToken = page.nextToken;
        if (!nextToken) break;
      }

      // 2. Progress enrichments for all entries (batched endpoint).
      const enrichments = await fetchEnrichments(
        context,
        endpoints,
        entries.map((e) => e.gti)
      );

      // 3. Metadata per unique title (one request each, cached within the sync).
      const metadataById = new Map<string, PrimeMetadataItem | null>();
      for (const entry of entries) {
        if (!metadataById.has(entry.gti)) {
          metadataById.set(entry.gti, await fetchMetadata(context, endpoints, entry.gti));
        }
      }

      if (options.saveFixture) {
        this.saveFixture({ historyPages: rawPages, enrichments });
      }

      const observedAt = new Date();
      const observations = entries.map((entry) => {
        const obs = buildObservation(
          entry,
          enrichments,
          metadataById.get(entry.gti) ?? null,
          observedAt
        );
        obs.profileId = profile.id;
        return obs;
      });
      log.info({ observations: observations.length }, "prime sync fetched");
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
