import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { BrowserProfileBusyError } from "../providers/errors";
import type { ProviderName } from "../providers/provider";
import { REMOTE_LOGIN_WS_PATH } from "../remote-login/remote-login.gateway";
import { RemoteLoginService } from "../remote-login/remote-login.service";
import { SyncService } from "../sync/sync.service";

@Controller("providers/:provider/login")
export class RemoteLoginController {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(
    @Inject(RemoteLoginService) private readonly remote: RemoteLoginService,
    @Inject(SyncService) private readonly sync: SyncService
  ) {}

  private assertKnown(name: string): ProviderName {
    if (!this.sync.providers[name as ProviderName]) {
      throw new NotFoundException(`Unknown provider: ${name}`);
    }
    return name as ProviderName;
  }

  /**
   * Open a streamed browser on the provider's login page. Returns a single-use
   * token for the frame WebSocket — treat it like a password.
   */
  @Post("start")
  async start(@Param("provider") name: string) {
    const provider = this.assertKnown(name);
    try {
      const session = await this.remote.start(provider);
      return {
        sessionId: session.id,
        token: session.token,
        provider: session.provider,
        width: session.width,
        height: session.height,
        streamPath: REMOTE_LOGIN_WS_PATH,
      };
    } catch (err) {
      if (err instanceof BrowserProfileBusyError) {
        throw new ConflictException(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already open")) {
        throw new ConflictException(message);
      }
      throw new HttpException({ error: message }, 502);
    }
  }

  @Get("status")
  status(@Param("provider") name: string) {
    this.assertKnown(name);
    const session = this.remote.current;
    return {
      active: session != null,
      provider: session?.provider ?? null,
      startedAt: session?.startedAt?.toISOString() ?? null,
      url: this.remote.currentUrl(),
    };
  }

  /**
   * Close the streamed browser. The persistent profile keeps whatever session
   * the user established, which is what subsequent syncs reuse.
   */
  @Post("finish")
  async finish(@Param("provider") name: string) {
    const provider = this.assertKnown(name);
    const session = this.remote.current;
    if (!session) {
      throw new BadRequestException("No active remote login session");
    }
    await this.remote.stop();

    // Report back whether the login actually took, using the provider's own check.
    let authenticated: boolean | null = null;
    let profileName: string | undefined;
    try {
      const status = await this.sync.getProvider(provider).isAuthenticated();
      authenticated = status.authenticated;
      profileName = status.profileName;
    } catch {
      // Profile may still be settling; the caller can re-check via /status.
      authenticated = null;
    }
    return { provider, authenticated, profileName: profileName ?? null };
  }
}
