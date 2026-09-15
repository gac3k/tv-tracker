import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
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
import { captureHomeSession, MAX_HOME } from "./api";
import { MAX_PARSER_VERSION, parseContinueWatching } from "./parser";

const log = logger.child({ provider: "max" });

/**
 * Max reads the "Continue Watching" rail by intercepting the web app's own
 * authenticated responses (see api.ts). Like Apple TV this yields in-progress
 * items without a played-percentage, not a full watch history.
 */
@ContentProvider({
  id: "max",
  label: "Max",
  auth: "browser",
  fields: [],
  parserVersion: MAX_PARSER_VERSION,
  loginUrl: MAX_HOME,
})
export class MaxProvider implements VodProvider {
  readonly name = "max" as const;

  async login(): Promise<void> {
    await runInteractiveLogin(this.name, `${MAX_HOME}/`, async (page) => {
      // Fresh navigation each probe so we re-capture the profiles response.
      const session = await captureHomeSession(page.context(), page, { timeoutMs: 8000 });
      return session.profileName;
    });
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const session = await captureHomeSession(context, page);
      return {
        authenticated: session.profileName != null,
        profileName: session.profileName ?? undefined,
      };
    } finally {
      await context.close();
    }
  }

  async sync(options: SyncOptions = {}): Promise<PlaybackObservation[]> {
    const context = await openBrowserContext(this.name, { headless: true });
    try {
      const page: Page = context.pages()[0] ?? (await context.newPage());
      const session = await captureHomeSession(context, page);
      if (session.profileName == null) {
        throw new ProviderAuthenticationError(
          "max",
          "No authenticated Max profile in the persisted browser session. Run: pnpm cli login max"
        );
      }
      log.debug({ profile: session.profileName }, "session active");

      if (!session.continueWatching) {
        // Authenticated but the rail did not load (empty, or markup changed).
        log.warn("Max Continue Watching rail did not load; nothing to sync");
        return [];
      }

      if (options.saveFixture) {
        this.saveFixture(session.continueWatching);
      }

      const observations = parseContinueWatching(session.continueWatching, new Date());
      for (const obs of observations) {
        obs.profileId = session.profileName ?? undefined;
      }
      log.info({ observations: observations.length }, "max continue-watching parsed");
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
