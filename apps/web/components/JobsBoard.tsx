"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobRun, JobsResponse } from "../lib/api";
import { formatDuration, formatWhen, jobStatusState, providerLabel, summaryLine } from "../lib/jobs";

export function JobsBoard({ initial }: { initial: JobsResponse }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const live = data.jobs.some((job) => job.status === "queued" || job.status === "running");
  const targets = data.targets ?? [];

  useEffect(() => {
    setData(initial);
  }, [initial]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch("/api/jobs")
        .then((res) => (res.ok ? res.json() : null))
        .then((next: JobsResponse | null) => {
          if (next) setData(next);
        });
    }, live ? 2000 : 8000);
    return () => window.clearInterval(timer);
  }, [live]);

  async function runNow() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ? { provider: target } : {}),
      });
      const body = (await res.json()) as JobRun & { error?: string };
      if (!res.ok) {
        setMessage(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/system/jobs/${body.id}`);
      router.refresh();
    } catch {
      setMessage("offline");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shelf-head">
        <h1 className="shelf-title">Jobs</h1>
        <p className="shelf-count">{data.jobs.length} recent</p>
        <div className="job-actions">
          <select
            className="select"
            aria-label="Job target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">All enabled</option>
            {["source", "plugin"].map((kind) => {
              const group = targets.filter((item) => item.kind === kind);
              if (group.length === 0) return null;
              return (
                <optgroup key={kind} label={kind === "source" ? "Sources" : "Plugins"}>
                  {group.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button className="button" type="button" onClick={() => void runNow()} disabled={busy}>
            {busy ? "Queuing…" : "Run"}
          </button>
        </div>
      </header>
      <p className="shelf-lede">
        {data.intervalMinutes > 0
          ? `Enabled sources sync every ${data.intervalMinutes} minutes. Pick a source or plugin and run it. Open a run for the debug log.`
          : "The scheduler is off (SYNC_INTERVAL_MINUTES=0). Pick a source or plugin and run it here."}
      </p>
      {message && <p className="hint">{message}</p>}
      {data.jobs.length === 0 ? (
        <div className="empty">No jobs yet. Run one now, or wait for the schedule.</div>
      ) : (
        <ul className="job-list">
          {data.jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/system/jobs/${job.id}`} className="job-row">
                <span className="dot" data-state={jobStatusState(job.status)} aria-hidden="true" />
                <span className="job-when">{formatWhen(job.startedAt)}</span>
                <span className="job-who">{providerLabel(job.provider)}</span>
                <span className="job-trigger">{job.trigger}</span>
                <span className="job-dur">{formatDuration(job.durationMs)}</span>
                <span className="job-summary">{summaryLine(job)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
