import type { JobRun } from "./api";
import { PROVIDER_LABELS } from "./api";

export function jobStatusState(status: string): "ok" | "bad" | "unknown" {
  if (status === "success") return "ok";
  if (status === "error") return "bad";
  return "unknown";
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function providerLabel(provider: string | null): string {
  if (!provider) return "All enabled";
  return PROVIDER_LABELS[provider] ?? provider;
}

export function jobFailures(job: JobRun): { provider: string; error: string; skipped: boolean }[] {
  const results = job.summary?.results ?? [];
  const fromResults = results
    .filter((result) => result.status === "error" || (result.status === "skipped" && result.error))
    .map((result) => ({
      provider: result.provider,
      error: result.error ?? (result.status === "skipped" ? result.skipReason ?? "skipped" : "failed"),
      skipped: result.status === "skipped",
    }));
  if (fromResults.length > 0) return fromResults;
  if (job.status === "error" && job.error) {
    return [{ provider: job.provider ?? "job", error: job.error, skipped: false }];
  }
  return [];
}

/** Failures from the latest finished job, in run order. */
export function recentFailures(jobs: JobRun[]): { jobId: number; provider: string; error: string; skipped: boolean }[] {
  const finished = jobs.find(
    (job) => job.status === "error" || job.status === "success" || job.status === "skipped"
  );
  if (!finished) return [];
  return jobFailures(finished).map((fail) => ({ jobId: finished.id, ...fail }));
}

export function summaryLine(job: JobRun): string {
  const results = job.summary?.results;
  if (results?.length) {
    return results
      .map((result) => {
        if (result.status === "success") {
          if (result.exported != null) {
            return `${providerLabel(result.provider)} ${result.exported} exported`;
          }
          return `${providerLabel(result.provider)} +${result.inserted ?? 0}/${result.fetched ?? 0}`;
        }
        if (result.status === "skipped") {
          return `${providerLabel(result.provider)} skipped`;
        }
        return `${providerLabel(result.provider)} failed`;
      })
      .join(" · ");
  }
  if (job.error) return job.error;
  if (job.status === "queued") return "waiting";
  if (job.status === "running") return "in progress";
  return job.status;
}
