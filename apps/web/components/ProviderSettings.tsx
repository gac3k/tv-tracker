"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProviderCatalogItem, ProviderField } from "../lib/api";
import { SyncButton } from "./SyncButton";

function formPayload(fields: ProviderField[], values: Record<string, string>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key] ?? "";
    if (field.type === "secret" && value === "") continue;
    payload[field.key] = value;
  }
  return payload;
}

export function ProviderSettings({ item }: { item: ProviderCatalogItem }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(item.enabled);
  const [includeData, setIncludeData] = useState(item.includeData);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.fields.map((field) => [field.key, item.values[field.key] ?? ""]))
  );
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [testedKey, setTestedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const payload = formPayload(item.fields, values);
  const payloadKey = JSON.stringify(payload);
  const tested = testedKey === payloadKey;

  async function patch(body: Record<string, unknown>) {
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch(`/api/providers/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMessage("Save failed");
        return;
      }
      setMessage("Saved");
      router.refresh();
    } catch {
      setMessage("Offline");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage(null);
    try {
      const res = await fetch(`/api/providers/${item.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: payload }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; profileName?: string | null };
      if (res.ok && body.ok) {
        setTestedKey(payloadKey);
        setMessage(body.profileName ? `Connected as ${body.profileName}` : "Connection OK");
      } else {
        setTestedKey(null);
        setMessage(body.error ?? "Connection failed");
      }
    } catch {
      setTestedKey(null);
      setMessage("Offline");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="provider-settings">
      <div className="provider-toggles">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy != null}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              setEnabled(next);
              void patch({ enabled: next });
            }}
          />
          {item.kind === "plugin" && item.exportWatched
            ? "Export after sync"
            : item.kind === "plugin"
              ? "Enable"
              : "Sync"}
        </label>
        {item.kind !== "plugin" && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeData}
              disabled={busy != null}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setIncludeData(next);
                void patch({ includeData: next });
              }}
            />
            Show in library
          </label>
        )}
      </div>

      {item.fields.length > 0 && (
        <form
          className="provider-fields"
          onSubmit={(event) => {
            event.preventDefault();
            if (!tested) return;
            void patch({ values: payload });
          }}
        >
          {item.fields.map((field) => (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                className="search"
                type={field.type === "secret" ? "password" : field.type === "url" ? "url" : "text"}
                name={field.key}
                placeholder={
                  field.type === "secret" && item.values[field.key] === null
                    ? "unchanged"
                    : (field.placeholder ?? "")
                }
                value={values[field.key] ?? ""}
                required={field.required && field.type !== "secret"}
                autoComplete="off"
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setValues((current) => ({ ...current, [field.key]: next }));
                }}
              />
              {field.help && <span className="field-help">{field.help}</span>}
            </label>
          ))}
          <div className="provider-actions">
            <button className="button-ghost" type="button" disabled={busy != null} onClick={() => void testConnection()}>
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button
              className="button"
              type="submit"
              disabled={busy != null || !tested}
              title={tested ? undefined : "Test the connection before saving"}
            >
              {busy === "save" ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      )}

      {item.id === "mcp" && (
        <p className="hint">
          In Home Assistant: Settings → Devices & services → Add integration → Model Context Protocol.
          SSE URL is <code>/mcp/sse</code> on this API host (port 3000). Enable that MCP API on the
          conversation agent next to Assist. Test with <code>/mcp/resolve?q=1670</code>.
        </p>
      )}

      <div className="provider-actions">
        {item.exportWatched && <SyncButton provider={item.id} exportWatched />}
        {message && <span className="card-sub">{message}</span>}
      </div>
    </div>
  );
}
