"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobRunDetail } from "../lib/api";
import { formatDuration, formatWhen, jobStatusState, providerLabel } from "../lib/jobs";

export function JobDetail({ initial }: { initial: JobRunDetail }) {
  const [job, setJob] = useState(initial);
  const live = job.status === "queued" || job.status === "running";

  useEffect(() => {
    setJob(initial);
  }, [initial]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/jobs/${job.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((next: JobRunDetail | null) => {
          if (next) setJob(next);
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [live, job.id]);

  return (
    <>
      <header className="shelf-head">
        <h1 className="shelf-title">Job #{job.id}</h1>
        <p className="shelf-count">
          <span className="dot" data-state={jobStatusState(job.status)} aria-hidden="true" />
          {job.status}
        </p>
      </header>
      <p className="shelf-lede">
        <Link href="/system/jobs" className="reset">
          All jobs
        </Link>
      </p>
      <dl className="job-meta">
        <div>
          <dt>Target</dt>
          <dd>{providerLabel(job.provider)}</dd>
        </div>
        <div>
          <dt>Trigger</dt>
          <dd>{job.trigger}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatWhen(job.startedAt)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(job.durationMs)}</dd>
        </div>
        <div>
          <dt>Queue id</dt>
          <dd>
            <code>{job.queueJobId ?? "—"}</code>
          </dd>
        </div>
        {job.errorType && (
          <div>
            <dt>Error</dt>
            <dd>
              {job.errorType}: {job.error}
            </dd>
          </div>
        )}
      </dl>
      {job.logs.length === 0 ? (
        <div className="empty">
          {job.status === "queued" ? "Waiting for the worker to pick this up." : "No log lines yet."}
        </div>
      ) : (
        <ol className="job-log">
          {job.logs.map((line) => (
            <li key={line.id} className="job-log-line" data-level={line.level}>
              <time dateTime={line.ts}>{formatWhen(line.ts)}</time>
              <span className="job-log-level">{line.level}</span>
              <span className="job-log-msg">{line.message}</span>
              {line.data != null && (
                <pre className="job-log-data">{JSON.stringify(line.data, null, 2)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
