"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton({
  provider,
  exportWatched = false,
  compact = false,
}: {
  provider: string;
  exportWatched?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const exportSink = exportWatched;

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/providers/${provider}/sync`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        setMessage(exportSink ? `${body.exported ?? 0} marked` : `+${body.inserted}`);
        router.refresh();
      } else {
        setMessage(body.error ? "failed" : `HTTP ${res.status}`);
      }
    } catch {
      setMessage("offline");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        className="reset"
        onClick={sync}
        disabled={busy}
        title={exportSink ? `Export ${provider}` : `Sync ${provider}`}
        aria-label={exportSink ? `Export ${provider}` : `Sync ${provider}`}
      >
        {busy ? (exportSink ? "exporting…" : "syncing…") : (message ?? (exportSink ? "export" : "sync"))}
      </button>
    );
  }

  return (
    <span>
      <button className="button" onClick={sync} disabled={busy}>
        {busy ? (exportSink ? "Exporting…" : "Syncing…") : exportSink ? "Export now" : "Sync now"}
      </button>
      {message && <span className="card-sub" style={{ marginLeft: "0.75rem" }}>{message}</span>}
    </span>
  );
}
