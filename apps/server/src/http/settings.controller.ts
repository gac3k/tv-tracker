import { BadRequestException, Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { tmdbApiKey, tmdbApiKeySource, setTmdbApiKey } from "../artwork/tmdb-key";
import { readAppSettings, TV_OS, writeAppSettings } from "../settings/app-settings";
import { appVersion } from "../version";

const patchSchema = z.object({
  tmdbApiKey: z.string().optional(),
  mcpEnabled: z.boolean().optional(),
  tvOs: z.enum(TV_OS).optional(),
});

@Controller("settings")
export class SettingsController {
  @Get()
  get() {
    const app = readAppSettings();
    return {
      version: appVersion(),
      tmdbApiKeySet: Boolean(tmdbApiKey()),
      tmdbApiKeySource: tmdbApiKeySource(),
      mcpEnabled: app.mcpEnabled,
      tvOs: app.tvOs,
    };
  }

  @Patch()
  patch(@Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    if (parsed.data.tmdbApiKey !== undefined) {
      if (tmdbApiKeySource() === "env") {
        throw new BadRequestException("TMDB_API_KEY is set from the environment");
      }
      setTmdbApiKey(parsed.data.tmdbApiKey);
    }
    if (parsed.data.mcpEnabled !== undefined || parsed.data.tvOs !== undefined) {
      writeAppSettings({
        ...(parsed.data.mcpEnabled !== undefined ? { mcpEnabled: parsed.data.mcpEnabled } : {}),
        ...(parsed.data.tvOs !== undefined ? { tvOs: parsed.data.tvOs } : {}),
      });
    }
    return this.get();
  }
}
