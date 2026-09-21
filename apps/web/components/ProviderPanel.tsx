"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProviderCatalogItem } from "../lib/api";
import { Icon } from "./Icon";
import { ProviderIcon } from "./ProviderIcon";

function statusState(status: string | null): "ok" | "bad" | "unknown" {
  if (status === "success") return "ok";
  if (status === "auth_required" || status === "error") return "bad";
  return "unknown";
}

export function ProviderPanel({ item }: { item: ProviderCatalogItem }) {
  const router = useRouter();
  const menuId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canSync = item.kind !== "plugin" || item.exportWatched;
  const exportSink = item.exportWatched;
  const syncLabel = exportSink ? "Export" : "Sync";

  function placeMenu() {
    const btn = btnRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;
    const rect = btn.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.right = `${document.documentElement.clientWidth - rect.right}px`;
    panel.style.left = "auto";
  }

  function closeMenu() {
    panelRef.current?.hidePopover();
  }

  async function sync() {
    closeMenu();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/providers/${item.id}/sync`, { method: "POST" });
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

  return (
    <article className="provider-card">
      <div className="card-menu">
        <button
          ref={btnRef}
          type="button"
          className="card-menu-btn"
          popoverTarget={menuId}
          aria-haspopup="menu"
          aria-label={`Actions for ${item.label}`}
        >
          <Icon name="dots-vertical" className="menu-icon" />
        </button>
        <div
          id={menuId}
          ref={panelRef}
          popover="auto"
          className="card-menu-panel"
          role="menu"
          onToggle={(event) => {
            if (event.newState === "open") placeMenu();
          }}
        >
          {canSync && (
            <button type="button" role="menuitem" onClick={() => void sync()} disabled={busy}>
              <Icon name={exportSink ? "upload" : "refresh"} className="menu-icon" />
              {busy ? (exportSink ? "Exporting…" : "Syncing…") : syncLabel}
            </button>
          )}
          <Link
            role="menuitem"
            href={`/providers/${item.id}/settings`}
            onClick={closeMenu}
          >
            <Icon name="settings" className="menu-icon" />
            Configure
          </Link>
          {item.auth === "browser" && (
            <Link
              role="menuitem"
              href={`/providers/${item.id}/login`}
              onClick={closeMenu}
            >
              <Icon name="login" className="menu-icon" />
              Sign in
            </Link>
          )}
        </div>
      </div>
      <span
        className="provider-mark"
        style={{ color: `var(--color-${item.id}, var(--color-ink-2))` }}
      >
        <ProviderIcon provider={item.id} size="lg" />
      </span>
      <h2 className="provider-card-title">{item.label}</h2>
      <p className="card-sub">
        <span
          className="dot"
          data-state={
            item.kind === "plugin" && !item.exportWatched
              ? item.enabled
                ? "ok"
                : "unknown"
              : statusState(item.lastSyncStatus)
          }
          aria-hidden="true"
        />
        {item.kind === "plugin" && !item.exportWatched
          ? item.enabled
            ? "enabled"
            : "disabled"
          : (item.lastSyncStatus ?? "never synced")}
      </p>
      {message && <p className="card-sub">{message}</p>}
    </article>
  );
}
