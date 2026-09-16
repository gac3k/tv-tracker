import Link from "next/link";
import type { ProviderCatalogItem } from "../lib/api";
import { ProviderIcon } from "./ProviderIcon";
import { SyncButton } from "./SyncButton";

function statusState(status: string | null): "ok" | "bad" | "unknown" {
  if (status === "success") return "ok";
  if (status === "auth_required" || status === "error") return "bad";
  return "unknown";
}

export function ProviderPanel({ item }: { item: ProviderCatalogItem }) {
  return (
    <article className="provider-card">
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
      <div className="provider-actions">
        {(item.kind !== "plugin" || item.exportWatched) && (
          <SyncButton provider={item.id} exportWatched={item.exportWatched} compact />
        )}
        <Link className="button-ghost" href={`/providers/${item.id}/settings`}>
          Configure
        </Link>
        {item.auth === "browser" && (
          <Link className="button-ghost" href={`/providers/${item.id}/login`}>
            Sign in
          </Link>
        )}
      </div>
    </article>
  );
}
