import { BadRequestException, Body, Controller, Get, Inject, Put } from "@nestjs/common";
import { z } from "zod";
import { tmdbApiKey, tmdbApiKeySource } from "../artwork/tmdb-key";
import { HomeAssistantMqtt } from "../hass/hass-mqtt";
import {
  envLockedKeys,
  readAppSettings,
  readConfigYaml,
  writeConfigYaml,
} from "../settings/app-settings";
import { appVersion } from "../version";

const putSchema = z.object({
  yaml: z.string().min(1).max(20_000),
});

@Controller("settings")
export class SettingsController {
  constructor(@Inject(HomeAssistantMqtt) private readonly hass: HomeAssistantMqtt) {}

  @Get()
  get() {
    const app = readAppSettings();
    return {
      version: appVersion(),
      yaml: readConfigYaml(),
      tmdbApiKeySet: Boolean(tmdbApiKey()),
      tmdbApiKeySource: tmdbApiKeySource(),
      mcpEnabled: app.mcpEnabled,
      tvOs: app.tvOs,
      mqttUrlSet: Boolean(app.mqttUrl),
      envLocks: envLockedKeys(),
    };
  }

  @Put()
  put(@Body() body: unknown) {
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    try {
      writeConfigYaml(parsed.data.yaml);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Invalid YAML");
    }
    this.hass.reconnect();
    return this.get();
  }
}
