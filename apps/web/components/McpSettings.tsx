"use client";

import { useState } from "react";

export function McpSettings({ enabled: initiallyEnabled }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(next: boolean) {
    setEnabled(next);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpEnabled: next }),
      });
      if (!res.ok) {
        setMessage("Save failed");
        setEnabled(enabled);
        return;
      }
      setMessage(next ? "MCP on" : "MCP off");
    } catch {
      setMessage("Offline");
      setEnabled(enabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="provider-settings" onSubmit={(event) => event.preventDefault()}>
      <div className="provider-toggles">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => void save(event.currentTarget.checked)}
          />
          Enable MCP server
        </label>
      </div>
      <p className="hint">
        In Home Assistant: Settings → Devices & services → Add integration → Model Context Protocol.
        URL is <code>/mcp</code> on this API host (e.g. <code>http://api.tv-tracker.lan/mcp</code>). Enable that MCP API on the
        conversation agent next to Assist. The <code>resolve_playback</code> tool returns a
        launcher deeplink for the TV OS chosen above. Test with <code>/mcp/resolve?q=1670</code>.
      </p>
      {message && <span className="card-sub">{message}</span>}
    </form>
  );
}
