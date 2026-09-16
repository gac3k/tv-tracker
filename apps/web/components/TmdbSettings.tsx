"use client";

import { useState } from "react";

export function TmdbSettings({
  set: initiallySet,
  source,
}: {
  set: boolean;
  source: "env" | "settings" | null;
}) {
  const fromEnv = source === "env";
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(initiallySet);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbApiKey: value }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setMessage(body?.message ?? `Save failed (${res.status})`);
        return;
      }
      setSaved(value.trim().length > 0);
      setValue("");
      setMessage(value.trim() ? "Saved" : "Cleared");
    } catch {
      setMessage("Offline");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="provider-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (fromEnv) return;
        void save();
      }}
    >
      <label className="field">
        <span>TMDB API key</span>
        <input
          className="search"
          type="password"
          value={fromEnv ? "" : value}
          disabled={fromEnv || busy}
          autoComplete="off"
          placeholder={fromEnv ? "set from TMDB_API_KEY" : saved ? "unchanged" : ""}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
        <span className="field-help">
          {fromEnv
            ? "This process has TMDB_API_KEY in the environment, so the field is locked."
            : "Artwork and catalog search use The Movie Database. You can also set TMDB_API_KEY instead of saving it here."}
        </span>
      </label>
      {!fromEnv && (
        <div className="provider-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save key"}
          </button>
          {message && <span className="card-sub">{message}</span>}
        </div>
      )}
    </form>
  );
}
