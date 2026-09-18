"use client";

import { useState } from "react";

export function TvOsSettings({ tvOs: initial }: { tvOs: "webos" | "android" }) {
  const [tvOs, setTvOs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(next: "webos" | "android") {
    setTvOs(next);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tvOs: next }),
      });
      if (!res.ok) {
        setMessage("Save failed");
        setTvOs(tvOs);
        return;
      }
      setMessage("Saved");
    } catch {
      setMessage("Offline");
      setTvOs(tvOs);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="provider-settings" onSubmit={(event) => event.preventDefault()}>
      <label className="field">
        <span>TV operating system</span>
        <select
          className="select"
          value={tvOs}
          disabled={busy}
          onChange={(event) => void save(event.currentTarget.value as "webos" | "android")}
        >
          <option value="webos">webOS</option>
          <option value="android">Android</option>
        </select>
        <span className="field-help">
          Used when Assist asks the tracker for a launcher deeplink. webOS returns{" "}
          <code>system.launcher/launch</code> ids; Android returns a content URI the system
          launcher can open.
        </span>
      </label>
      {message && <span className="card-sub">{message}</span>}
    </form>
  );
}
