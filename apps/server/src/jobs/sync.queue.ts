import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";
import { BrowserProfileBusyError, ProviderAuthenticationError } from "../providers/errors";
import { JobsService, type JobTrigger, type ProviderSyncSummary } from "./jobs.service";

export const SYNC_QUEUE = "sync";
const SCHEDULER_ID = "sync-all";
const JOB_WAIT_MS = 15 * 60_000;

export interface SyncJobData {
  trigger: JobTrigger;
  provider?: string;
  runId?: number;
}

function redisConnection() {
  const url = new URL(config.REDIS_URL);
  return {
    host: url.hostname || "127.0.0.1",
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Clock-aligned cron when it maps cleanly — avoids an immediate sync on every process start. */
function repeatOpts(minutes: number): { pattern: string } | { every: number } {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return { pattern: hours === 1 ? "0 * * * *" : `0 */${hours} * * *` };
  }
  if (minutes < 60 && 60 % minutes === 0) {
    return { pattern: `*/${minutes} * * * *` };
  }
  return { every: minutes * 60_000 };
}

@Injectable()
export class SyncQueue implements OnApplicationShutdown {
  private queue: Queue<SyncJobData> | null = null;
  private worker: Worker<SyncJobData> | null = null;
  private events: QueueEvents | null = null;

  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  /** HTTP entrypoint only — the CLI shares AppModule but must not start a second worker. */
  async start(): Promise<void> {
    const connection = redisConnection();
    this.queue = new Queue<SyncJobData>(SYNC_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    });
    this.events = new QueueEvents(SYNC_QUEUE, { connection });
    this.worker = new Worker<SyncJobData>(SYNC_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      logger.error(
        { jobId: job?.id, err: err.message },
        "sync job failed"
      );
    });

    await Promise.race([
      Promise.all([this.queue.waitUntilReady(), this.events.waitUntilReady(), this.worker.waitUntilReady()]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Redis did not become ready in 5s (${config.REDIS_URL}). Start redis or set REDIS_URL.`
              )
            ),
          5_000
        )
      ),
    ]);

    const minutes = config.SYNC_INTERVAL_MINUTES;
    if (minutes > 0) {
      const repeat = repeatOpts(minutes);
      const existing = await this.queue.getJobScheduler(SCHEDULER_ID);
      const same =
        existing != null &&
        ("pattern" in repeat
          ? existing.pattern === repeat.pattern
          : Number(existing.every) === repeat.every);
      if (!same) {
        await this.queue.upsertJobScheduler(SCHEDULER_ID, repeat, {
          name: "sync",
          data: { trigger: "schedule" },
        });
      }
      logger.info({ minutes, redis: config.REDIS_URL, ...repeat }, "sync scheduler enabled");
    } else {
      await this.queue.removeJobScheduler(SCHEDULER_ID);
      logger.info("sync scheduler disabled (SYNC_INTERVAL_MINUTES=0)");
    }
  }

  async enqueue(data: SyncJobData) {
    if (!this.queue) throw new Error("sync queue is not started");
    const run = this.jobs.begin({
      trigger: data.trigger,
      provider: data.provider ?? null,
      status: "queued",
    });
    const job = await this.queue.add("sync", { ...data, runId: run.id });
    if (job.id) this.jobs.setQueueJobId(run.id, job.id);
    return { run, job };
  }

  async enqueueAndWait(data: SyncJobData) {
    if (!this.events) throw new Error("sync queue is not started");
    const { run, job } = await this.enqueue(data);
    try {
      const result = (await job.waitUntilFinished(this.events, JOB_WAIT_MS)) as {
        runId: number;
        results: ProviderSyncSummary[];
      };
      const saved = this.jobs.get(run.id);
      if (data.provider && saved && saved.status !== "success") rethrowFromJob(saved);
      return result;
    } catch (err) {
      const saved = this.jobs.get(run.id);
      if (saved && saved.status !== "success") rethrowFromJob(saved);
      throw err;
    }
  }

  private async process(job: Job<SyncJobData>) {
    const data = job.data ?? { trigger: "schedule" as const };
    return this.jobs.execute({
      trigger: data.trigger ?? "schedule",
      provider: data.provider,
      runId: data.runId,
      queueJobId: job.id,
      jobLog: (line) => job.log(line),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
    this.worker = null;
    this.events = null;
    this.queue = null;
  }
}

function rethrowFromJob(run: { provider: string | null; error: string | null; errorType: string | null }): never {
  const message = run.error ?? "sync failed";
  const provider = run.provider ?? "unknown";
  if (run.errorType === "ProviderAuthenticationError") {
    throw new ProviderAuthenticationError(provider, message);
  }
  if (run.errorType === "BrowserProfileBusyError") {
    throw new BrowserProfileBusyError(provider, message);
  }
  throw new Error(message);
}
