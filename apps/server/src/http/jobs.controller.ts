import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { config } from "../config";
import { JobsService } from "../jobs/jobs.service";
import { SyncQueue } from "../jobs/sync.queue";

const runSchema = z.object({
  provider: z.string().min(1).optional(),
});

@Controller("jobs")
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(SyncQueue) private readonly queue: SyncQueue
  ) {}

  @Get()
  list() {
    return {
      intervalMinutes: config.SYNC_INTERVAL_MINUTES,
      targets: this.jobs.targets(),
      jobs: this.jobs.list(100),
    };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    const run = this.jobs.get(Number(id));
    if (!run) throw new NotFoundException(`Unknown job: ${id}`);
    return run;
  }

  @Post()
  async run(@Body() body: unknown) {
    const parsed = runSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { run } = await this.queue.enqueue({
      trigger: "manual",
      provider: parsed.data.provider,
    });
    return this.jobs.get(run.id);
  }
}
