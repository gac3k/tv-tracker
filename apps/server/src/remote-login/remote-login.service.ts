import { randomBytes } from "node:crypto";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { openBrowserContext } from "../browser/session";
import { logger } from "../logger";
import type { ProviderName } from "../providers/provider";
import { ProviderRegistry } from "../providers/registry.service";

const log = logger.child({ component: "remote-login" });

/** Auto-close an abandoned session so a browser profile is never left locked. */
const SESSION_TTL_MS = 15 * 60_000;

export interface RemoteLoginSession {
  id: string;
  /** Single-use secret required to attach the frame stream. */
  token: string;
  provider: ProviderName;
  startedAt: Date;
  width: number;
  height: number;
}

export type FrameHandler = (frame: { data: string; width: number; height: number }) => void;

interface ActiveSession extends RemoteLoginSession {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  onFrame: FrameHandler | null;
  /** Set once a client has consumed the token, so it cannot be reused. */
  attached: boolean;
  expiry: NodeJS.Timeout;
}

/**
 * Streams a real browser to the user's own browser, so an interactive provider
 * login works on a headless box (Docker, LXC, remote homelab) with no X server,
 * no VNC daemon and no extra system packages.
 *
 * The browser runs headless server-side; CDP's screencast supplies the frames
 * and CDP input events replay the user's mouse/keyboard. Effectively a purpose-
 * built VNC that only ever exposes one page.
 *
 * SECURITY: the streamed page is where the user types streaming-service
 * credentials. One session at a time, a single-use token gates the stream,
 * frames and keystrokes are never logged, and the HTTP server binds to
 * 127.0.0.1 unless the operator explicitly opts out.
 */
@Injectable()
export class RemoteLoginService implements OnApplicationShutdown {
  private session: ActiveSession | null = null;

  constructor(@Inject(ProviderRegistry) private readonly registry?: ProviderRegistry) {}

  get current(): RemoteLoginSession | null {
    if (!this.session) return null;
    // Never hand the token back out after creation.
    const { id, provider, startedAt, width, height } = this.session;
    return { id, token: "", provider, startedAt, width, height };
  }

  /** Launch the provider's login page and return the stream credentials. */
  async start(
    provider: ProviderName,
    size: { width: number; height: number } = { width: 1280, height: 800 }
  ): Promise<RemoteLoginSession> {
    if (this.session) {
      throw new Error(
        `A remote login session for ${this.session.provider} is already open. Finish or cancel it first.`
      );
    }

    // Headless is intentional: the user sees the page through our own stream,
    // which is exactly what makes this work without a display.
    const context = await openBrowserContext(provider, { headless: true });
    let page: Page;
    let cdp: CDPSession;
    try {
      page = context.pages()[0] ?? (await context.newPage());
      await page.setViewportSize(size);
      await page
        .goto(this.loginUrl(provider), { waitUntil: "domcontentloaded", timeout: 45_000 })
        .catch(() => undefined); // the user can navigate manually if this fails
      cdp = await context.newCDPSession(page);
    } catch (err) {
      await context.close();
      throw err;
    }

    const session: ActiveSession = {
      id: randomBytes(8).toString("hex"),
      token: randomBytes(24).toString("base64url"),
      provider,
      startedAt: new Date(),
      width: size.width,
      height: size.height,
      context,
      page,
      cdp,
      onFrame: null,
      attached: false,
      expiry: setTimeout(() => {
        log.warn({ provider }, "remote login session expired, closing");
        void this.stop();
      }, SESSION_TTL_MS),
    };
    session.expiry.unref();

    cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
      // Ack immediately or Chromium stops producing frames.
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      session.onFrame?.({ data: frame.data, width: session.width, height: session.height });
    });

    this.session = session;
    log.info({ provider, sessionId: session.id }, "remote login session started");
    return {
      id: session.id,
      token: session.token,
      provider,
      startedAt: session.startedAt,
      width: session.width,
      height: session.height,
    };
  }

  /** Validate a stream token. Single-use: a second attach with it is refused. */
  claim(sessionId: string, token: string): boolean {
    const session = this.session;
    if (!session || session.id !== sessionId || session.attached) return false;
    // Constant-length compare is overkill for a local single-use token, but the
    // lengths must match before comparing.
    if (token.length !== session.token.length || token !== session.token) return false;
    session.attached = true;
    return true;
  }

  async attachStream(handler: FrameHandler): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("No active remote login session");
    session.onFrame = handler;
    await session.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 65,
      maxWidth: session.width,
      maxHeight: session.height,
      everyNthFrame: 1,
    });
  }

  detachStream(): void {
    if (!this.session) return;
    this.session.onFrame = null;
    void this.session.cdp.send("Page.stopScreencast").catch(() => undefined);
  }

  /** Replay a pointer event. Coordinates are in the streamed viewport's space. */
  async pointer(
    type: "move" | "down" | "up" | "wheel",
    x: number,
    y: number,
    options: { button?: "left" | "right" | "middle"; deltaX?: number; deltaY?: number } = {}
  ): Promise<void> {
    const page = this.session?.page;
    if (!page) return;
    const mouse = page.mouse;
    switch (type) {
      case "move":
        await mouse.move(x, y);
        break;
      case "down":
        await mouse.move(x, y);
        await mouse.down({ button: options.button ?? "left" });
        break;
      case "up":
        await mouse.up({ button: options.button ?? "left" });
        break;
      case "wheel":
        await mouse.move(x, y);
        await mouse.wheel(options.deltaX ?? 0, options.deltaY ?? 0);
        break;
    }
  }

  /**
   * Replay a keyboard event. `text` inserts literal characters (so passwords and
   * non-Latin input work); `key` presses a named key (Enter, Tab, Backspace…).
   * Neither value is ever logged.
   */
  async keyboard(action: "text" | "press", value: string): Promise<void> {
    const page = this.session?.page;
    if (!page) return;
    if (action === "text") {
      await page.keyboard.insertText(value);
    } else {
      await page.keyboard.press(value);
    }
  }

  async navigate(url: string): Promise<void> {
    const page = this.session?.page;
    if (!page) return;
    // Only http(s): a streamed page must not be pointed at file:// or similar.
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http(s) URLs are allowed");
    }
    await page.goto(parsed.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  currentUrl(): string | null {
    return this.session?.page.url() ?? null;
  }

  private loginUrl(provider: ProviderName): string {
    if (!this.registry) {
      throw new Error("Provider registry is not available");
    }
    const entry = this.registry.get(provider);
    if (entry.meta.auth !== "browser" || !entry.meta.loginUrl) {
      throw new Error(`${provider} does not support browser login`);
    }
    return entry.meta.loginUrl;
  }

  /** Close the session; the browser profile keeps whatever was logged in. */
  async stop(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearTimeout(session.expiry);
    session.onFrame = null;
    await session.cdp.send("Page.stopScreencast").catch(() => undefined);
    await session.context.close().catch(() => undefined);
    log.info({ provider: session.provider }, "remote login session closed");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }
}
