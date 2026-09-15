import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { WatchlistService } from "../watchlist/watchlist.service";

const addSchema = z.object({
  tmdbType: z.enum(["tv", "movie"]),
  tmdbId: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  posterPath: z.string().max(240).nullable().optional(),
});

const typeSchema = z.enum(["tv", "movie"]);

@Controller()
export class WatchlistController {
  constructor(@Inject(WatchlistService) private readonly watchlist: WatchlistService) {}

  @Get("watchlist")
  list() {
    return { items: this.watchlist.list() };
  }

  @Post("watchlist")
  add(@Body() body: unknown) {
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.watchlist.add(parsed.data);
  }

  @Delete("watchlist/:type/:id")
  remove(@Param("type") type: string, @Param("id") id: string) {
    const tmdbType = typeSchema.safeParse(type);
    const tmdbId = z.coerce.number().int().positive().safeParse(id);
    if (!tmdbType.success || !tmdbId.success) throw new BadRequestException("invalid title");
    const result = this.watchlist.remove(tmdbType.data, tmdbId.data);
    if (!result.removed) throw new NotFoundException();
    return result;
  }

  @Get("catalog/search")
  search(@Query("q") q: string | undefined) {
    return this.watchlist.search(q ?? "");
  }

  @Get("upcoming")
  upcoming() {
    return this.watchlist.upcoming();
  }
}
