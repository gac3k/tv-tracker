import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ShowsService } from "../shows/shows.service";

const typeSchema = z.enum(["tv", "movie"]);
const idSchema = z.coerce.number().int().positive();
const progressSchema = z.object({
  mark: z.enum(["caught_up", "season", "episode", "watched"]),
  season: z.number().int().min(0).max(100).optional(),
  episode: z.number().int().min(1).max(10_000).optional(),
  watched: z.boolean().optional(),
});

@Controller("shows")
export class ShowsController {
  constructor(@Inject(ShowsService) private readonly shows: ShowsService) {}

  @Get()
  list() {
    return this.shows.list();
  }

  @Get("tv/:id")
  catalog(@Param("id") id: string) {
    const tmdbId = idSchema.safeParse(id);
    if (!tmdbId.success) throw new BadRequestException("invalid title");
    return this.shows.catalog(tmdbId.data);
  }

  @Post(":type/:id/progress")
  progress(@Param("type") type: string, @Param("id") id: string, @Body() body: unknown) {
    const tmdbType = typeSchema.safeParse(type);
    const tmdbId = idSchema.safeParse(id);
    const parsed = progressSchema.safeParse(body);
    if (!tmdbType.success || !tmdbId.success || !parsed.success) {
      throw new BadRequestException("invalid progress");
    }
    return this.shows.progress(tmdbType.data, tmdbId.data, parsed.data);
  }
}
