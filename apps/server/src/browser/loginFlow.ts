import readline from "node:readline";
import type { Page } from "playwright";
import { openBrowserContext } from "./session";
import type { ProviderName } from "../providers/provider";

/**
 * Shared interactive login flow: open a visible browser on the provider's
 * login page, poll `probe` until it reports an authenticated profile, and
 * keep the window open until the user presses Enter.
 *
 * `probe` runs against the most recently opened page and should return the
 * profile name (or empty string when authenticated but nameless), or null
 * when not authenticated yet. Probe errors are swallowed (page mid-navigation).
 */
export async function runInteractiveLogin(
  provider: ProviderName,
  startUrl: string,
  probe: (page: Page) => Promise<string | null>
): Promise<void> {
  // Interactive login needs a visible browser. On a headless Linux box (Docker,
  // remote homelab) there is usually no display — point the user at the two
  // supported setup flows instead of failing with a cryptic Chromium error.
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    console.warn(
      "\nNo display detected ($DISPLAY unset). Interactive login opens a visible browser.\n" +
        "On a headless/remote server you have two options:\n" +
        "  1. Run `pnpm cli login " +
        provider +
        "` on a desktop, then copy apps/server/.data/browser/" +
        provider +
        " to the server's data volume.\n" +
        "  2. Provide a display in the container (Xvfb + noVNC) — see README \"Headless / remote setup\".\n" +
        "Attempting to launch anyway (works if an X server like Xvfb is present)...\n"
    );
  }
  const context = await openBrowserContext(provider, { headless: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {
      /* user can navigate manually */
    });
    console.log(`\nLog in to ${provider} in the opened browser (select your profile if asked).`);
    console.log("Waiting for an authenticated session (checked every 3s)...\n");

    const poll = setInterval(() => {
      void (async () => {
        const current = context.pages().at(-1);
        if (!current) return;
        try {
          const profileName = await probe(current);
          if (profileName !== null) {
            console.log(
              `Detected authenticated session${profileName ? ` (profile: ${profileName})` : ""}. ` +
                "You can press Enter to close the browser."
            );
            clearInterval(poll);
          }
        } catch {
          // Page mid-navigation — try again on the next tick.
        }
      })();
    }, 3000);

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("Press Enter here when you are done logging in... ", () => {
        rl.close();
        resolve();
      });
    });
    clearInterval(poll);
  } finally {
    await context.close();
  }
  console.log("Browser session saved.");
}
