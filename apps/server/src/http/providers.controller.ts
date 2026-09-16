import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { logger } from "../logger";
import { ObservationsService } from "../observations/observations.service";
import { PluginRegistry } from "../plugins/registry.service";
import { BrowserProfileBusyError, ProviderAuthenticationError } from "../providers/errors";
import { mergeProviderValues, redactValues } from "../providers/registry.service";
import { ProviderRegistry } from "../providers/registry.service";
import { SyncQueue } from "../jobs/sync.queue";
import { assertExtensionToken } from "../extension-token";
import { parseImportedCookies, writeImportedCookies } from "../browser/cookies";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  includeData: z.boolean().optional(),
  values: z.record(z.string(), z.string()).optional(),
});

@Controller("providers")
export class ProvidersController {
  constructor(
    @Inject(SyncQueue) private readonly queue: SyncQueue,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(ObservationsService) private readonly observations: ObservationsService
  ) {}

  @Get()
  listProviders() {
    const ids = [...this.registry.all().map((entry) => entry.meta.id), ...this.plugins.all().map((entry) => entry.meta.id)];
    return { providers: ids.map((id) => this.toCatalog(id)) };
  }

  @Get(":provider")
  getProvider(@Param("provider") name: string) {
    return this.toCatalog(name);
  }

  @Get(":provider/status")
  async status(@Param("provider") name: string, @Query("live") live?: string) {
    const entry = this.lookup(name);
    entry.instance.applySettings?.(entry.settings);
    const state = this.observations.getSyncState(name);

    let authenticated: boolean | null =
      state?.lastSyncStatus === "auth_required"
        ? false
        : state?.lastSyncStatus === "success"
          ? true
          : null;
    if (live === "1" || live === "true") {
      try {
        authenticated = (await entry.instance.isAuthenticated?.())?.authenticated ?? authenticated;
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "auth check failed");
      }
    }
    return {
      provider: name,
      authenticated,
      lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      lastSyncStatus: state?.lastSyncStatus ?? null,
      lastError: state?.lastError ?? null,
    };
  }

  @Post(":provider/test")
  async testConnection(@Param("provider") name: string, @Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const entry = this.lookup(name);
    const settings = {
      ...entry.settings,
      values: mergeProviderValues(entry.settings.values, parsed.data.values),
    };
    entry.instance.applySettings?.(settings);
    try {
      const status = await entry.instance.isAuthenticated?.();
      if (!status?.authenticated) {
        return { ok: false, error: "Connection failed" };
      }
      return { ok: true, profileName: status.profileName ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      return { ok: false, error: message };
    } finally {
      entry.instance.applySettings?.(entry.settings);
    }
  }

  @Patch(":provider")
  patchProvider(@Param("provider") name: string, @Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    if (this.plugins.has(name)) this.plugins.writeSettings(name, parsed.data);
    else if (this.registry.has(name)) this.registry.writeSettings(name, parsed.data);
    else throw new NotFoundException(`Unknown provider: ${name}`);
    return this.toCatalog(name);
  }

  /**
   * Import cookies captured by the browser extension. Written as cookies.json
   * inside the provider profile and applied on the next Chromium launch.
   */
  @Post(":provider/session")
  importSession(
    @Param("provider") name: string,
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined
  ) {
    assertExtensionToken(authorization);
    const entry = this.lookup(name);
    const domains = "cookieDomains" in entry.meta ? (entry.meta.cookieDomains ?? []) : [];
    if (entry.meta.auth !== "browser" || domains.length === 0) {
      throw new BadRequestException("Provider does not accept browser sessions");
    }
    try {
      const cookies = parseImportedCookies(body, domains);
      writeImportedCookies(name, cookies);
      logger.info({ provider: name, imported: cookies.length }, "stored imported browser session");
      void this.queue.enqueue({ trigger: "manual", provider: name }).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), provider: name },
          "session imported but sync did not queue"
        );
      });
      return { provider: name, saved: cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid session payload";
      throw new BadRequestException(message);
    }
  }

  @Post(":provider/sync")
  async triggerSync(@Param("provider") name: string) {
    if (!this.registry.has(name) && !this.plugins.has(name)) {
      throw new NotFoundException(`Unknown provider: ${name}`);
    }
    try {
      const { results } = await this.queue.enqueueAndWait({ trigger: "manual", provider: name });
      return { provider: name, ...results[0] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.name : "Error";
      if (err instanceof ProviderAuthenticationError) {
        throw new HttpException({ error: message, errorType }, 401);
      }
      if (err instanceof BrowserProfileBusyError) {
        throw new HttpException({ error: message, errorType }, 409);
      }
      throw new HttpException({ error: message, errorType }, 502);
    }
  }

  private lookup(name: string) {
    if (this.plugins.has(name)) return this.plugins.get(name);
    if (this.registry.has(name)) return this.registry.get(name);
    throw new NotFoundException(`Unknown provider: ${name}`);
  }

  private toCatalog(name: string) {
    const plugin = this.plugins.has(name);
    const entry = this.lookup(name);
    const state = this.observations.getSyncState(name);
    return {
      id: entry.meta.id,
      label: entry.meta.label,
      description: entry.meta.description ?? null,
      auth: entry.meta.auth,
      kind: plugin ? "plugin" : "source",
      exportWatched: plugin ? "on" in entry.instance : false,
      fields: entry.meta.fields,
      cookieDomains: "cookieDomains" in entry.meta ? (entry.meta.cookieDomains ?? []) : [],
      loginUrl: "loginUrl" in entry.meta ? (entry.meta.loginUrl ?? null) : null,
      enabled: entry.settings.enabled,
      includeData: entry.settings.includeData,
      values: redactValues(entry.meta.fields, entry.settings.values),
      lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      lastSyncStatus: state?.lastSyncStatus ?? null,
      lastError: state?.lastError ?? null,
    };
  }
}
