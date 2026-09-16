import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import { ObservationsService } from "../observations/observations.service";
import { SessionsService } from "../sessions/sessions.service";
import { appVersion } from "../version";

const historyQuerySchema = z.object({
  provider: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  since: z.coerce.date().optional(),
});

function parseQuery(query: unknown) {
  const parsed = historyQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues);
  }
  return parsed.data;
}

@Controller()
export class HistoryController {
  // Explicit @Inject: tsx/esbuild does not emit decorator metadata.
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(ObservationsService) private readonly observations: ObservationsService
  ) {}

  @Get("health")
  health() {
    return { status: "ok", version: appVersion() };
  }

  /** Derived playback sessions (our "history" view). */
  @Get("history")
  history(@Query() query: unknown) {
    return { sessions: this.sessions.list(parseQuery(query)) };
  }

  /** Raw normalized observations. */
  @Get("observations")
  list(@Query() query: unknown) {
    const rows = this.observations.list(parseQuery(query)).map(
      ({ raw: _raw, ...rest }) => rest // keep responses small; raw stays in the DB
    );
    return { observations: rows };
  }

  @Get("now-playing")
  nowPlaying() {
    return this.sessions.nowPlaying();
  }
}
