"use client";

import { useEffect, useState } from "react";

export function ConfigYamlEditor({
  yaml: initial,
  envLocks,
}: {
  yaml: string;
  envLocks: string[];
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = text !== saved;

  useEffect(() => {
    setText(initial);
    setSaved(initial);
  }, [initial]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: text }),
      });
      const body = (await res.json().catch(() => null)) as { yaml?: string; message?: string } | null;
      if (!res.ok) {
        setMessage(body?.message ?? `Save failed (${res.status})`);
        return;
      }
      if (body?.yaml != null) {
        setText(body.yaml);
        setSaved(body.yaml);
      } else {
        setSaved(text);
      }
      setMessage("Saved");
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
        void save();
      }}
    >
      <label className="field">
        <span>config.yaml</span>
        <textarea
          className="config-yaml"
          spellCheck={false}
          rows={18}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <span className="field-help">
          Written to <code>$DATA_DIR/config.yaml</code>. Environment variables win when set
          {envLocks.length > 0 ? `: ${envLocks.join(", ")}` : ""}.
        </span>
      </label>
      <div className="provider-actions">
        <button className="button" type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </button>
        {message && <span className="card-sub">{message}</span>}
      </div>
    </form>
  );
}
