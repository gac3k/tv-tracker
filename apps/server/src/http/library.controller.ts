import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { LibraryService } from "../library/library.service.js";

const librarySchema = z.object({
  /** Comma-separated provider names, e.g. `?provider=netflix,prime`. */
  provider: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined)),
  type: z.enum(["movie", "episode"]).optional(),
  status: z.enum(["all", "in_progress", "completed", "unwatched"]).default("all"),
  q: z.string().optional(),
  sort: z.enum(["recent", "progress", "title"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  view: z.enum(["episodes", "titles"]).default("episodes"),
  tracking: z.enum(["active", "removed"]).default("active"),
});

const actionSchema = z.object({
  action: z.enum(["watched", "hidden", "restore"]),
  keys: z.array(z.string().min(1).max(240)).min(1).max(500),
});

@Controller("library")
export class LibraryController {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(@Inject(LibraryService) private readonly library: LibraryService) {}

  @Get()
  async list(@Query() query: unknown) {
    const parsed = librarySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const { provider, type, status, q, sort, limit, view, tracking } = parsed.data;
    return this.library.list({
      providers: provider,
      mediaType: type,
      status,
      q,
      sort,
      limit,
      view,
      tracking,
    });
  }

  @Post("actions")
  actions(@Body() body: unknown) {
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.library.applyActions(parsed.data.action, parsed.data.keys);
  }
}
