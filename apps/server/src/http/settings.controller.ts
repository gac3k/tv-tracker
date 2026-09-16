import { BadRequestException, Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { tmdbApiKey, tmdbApiKeySource, setTmdbApiKey } from "../artwork/tmdb-key";
import { appVersion } from "../version";

const patchSchema = z.object({
  tmdbApiKey: z.string().optional(),
});

@Controller("settings")
export class SettingsController {
  @Get()
  get() {
    return {
      version: appVersion(),
      tmdbApiKeySet: Boolean(tmdbApiKey()),
      tmdbApiKeySource: tmdbApiKeySource(),
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
    return this.get();
  }
}
