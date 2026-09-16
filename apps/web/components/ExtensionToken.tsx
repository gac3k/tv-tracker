"use client";

import { useState } from "react";

export function ExtensionToken({ token }: { token: string | null }) {
  const [copied, setCopied] = useState<"token" | "url" | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (!token) {
    return <p className="hint">API server unreachable — start it to mint an extension token.</p>;
  }

  function copy(label: "token" | "url", value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="provider-settings">
      <label className="field">
        <span>Tracker URL</span>
        <input className="search" type="text" readOnly value={origin} />
        <span className="field-help">
          Paste this into the extension — the dashboard URL is enough, it proxies{" "}
          <code>/api/*</code> to the API. HTTP is fine on localhost, private IPs,{" "}
          <code>*.lan</code> and <code>*.local</code>.
        </span>
      </label>
      <label className="field">
        <span>Extension token</span>
        <input className="search" type="text" readOnly value={token} />
        <span className="field-help">
          Stored in <code>.data/extension.token</code>.
        </span>
      </label>
      <div className="provider-actions">
        <button className="button-ghost" type="button" onClick={() => copy("url", origin)}>
          {copied === "url" ? "Copied" : "Copy URL"}
        </button>
        <button className="button-ghost" type="button" onClick={() => copy("token", token)}>
          {copied === "token" ? "Copied" : "Copy token"}
        </button>
      </div>
    </div>
  );
}
