"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import type { LibraryCard } from "../lib/api";
import { PROVIDER_LABELS } from "../lib/api";
import { ProviderIcon } from "./ProviderIcon";

/** Deterministic hue from the title, so placeholder tiles stay stable per item. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

function episodeLabel(item: LibraryCard): string | null {
  if (item.seasonNumber == null || item.episodeNumber == null) return null;
  return `S${item.seasonNumber}·E${item.episodeNumber}`;
}

function remainingLabel(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

export function PosterCard({
  item,
  mode = "library",
  selecting = false,
  selected = false,
  onToggleSelect,
  onAction,
}: {
  item: LibraryCard;
  mode?: "library" | "removed";
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onAction?: (action: "watched" | "hidden" | "restore", key: string) => void;
}) {
  const heading = item.showTitle ?? item.title ?? item.providerContentId;
  const secondary = item.showTitle ? item.title : null;
  const poster = item.artwork?.posterUrl ?? item.artwork?.stillUrl ?? null;
  const episode = episodeLabel(item);
  const remaining = remainingLabel(item.remainingSeconds);
  const providers = item.providers?.length ? item.providers : [item.provider];
  const providerLabel = providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ");
  const fullTitle = secondary ? `${heading} — ${secondary}` : heading;
  const episodeCount =
    item.episodeCount != null && item.episodeCount > 1 ? `${item.episodeCount} episodes` : null;
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (event.target instanceof Node && menu.contains(event.target)) return;
      menu.open = false;
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const artwork = poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
    <img src={poster} alt="" loading="lazy" decoding="async" />
  ) : (
    <div
      className="poster-fallback"
      style={{ ["--fallback-a" as string]: `oklch(30% 0.06 ${hueFor(heading)})` }}
    >
      <span>{heading}</span>
    </div>
  );

  const overlays = (
    <>
      {episode && <span className="badge">{episode}</span>}
      {item.completed && (
        <span className="badge-done" title="Watched">
          ✓
        </span>
      )}
      {item.url && (
        <span className="play" aria-hidden="true">
          ▶
        </span>
      )}
      {item.progress != null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={Math.round(item.progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${heading} progress`}
        >
          <div
            className="progress-fill"
            data-complete={item.completed ? "true" : "false"}
            data-derived={item.progressSource === "derived" ? "true" : "false"}
            style={{ ["--progress" as string]: String(Math.min(1, Math.max(0.02, item.progress / 100))) }}
          />
        </div>
      )}
    </>
  );

  function interceptPosterClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!selecting) return;
    event.preventDefault();
    onToggleSelect?.();
  }

  const posterInner = item.url ? (
    <a
      className="poster"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open “${fullTitle}” on ${providerLabel}`}
      onClick={interceptPosterClick}
    >
      {artwork}
      {overlays}
    </a>
  ) : (
    <div className="poster" onClick={selecting ? onToggleSelect : undefined}>
      {artwork}
      {overlays}
    </div>
  );

  return (
    <article className="card" data-selected={selected ? "true" : undefined}>
      <div className="poster-slot">
        {posterInner}
        {selecting ? (
          <label className="card-check">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.()}
              aria-label={`Select “${fullTitle}”`}
            />
          </label>
        ) : onAction ? (
          <details ref={menuRef} className="card-menu">
            <summary aria-label={`Actions for “${fullTitle}”`}>⋯</summary>
            <div className="card-menu-panel" role="menu">
              {mode === "removed" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    menuRef.current && (menuRef.current.open = false);
                    onAction?.("restore", item.key);
                  }}
                >
                  Restore to tracking
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      menuRef.current && (menuRef.current.open = false);
                      onAction?.("watched", item.key);
                    }}
                  >
                    Mark as Watched
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      menuRef.current && (menuRef.current.open = false);
                      onAction?.("hidden", item.key);
                    }}
                  >
                    Remove from tracking
                  </button>
                </>
              )}
            </div>
          </details>
        ) : null}
      </div>

      <h3 className="card-title" title={fullTitle}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={interceptPosterClick}>
            {heading}
          </a>
        ) : (
          heading
        )}
      </h3>
      <p className="card-sub">
        {providers.map((provider) => (
          <span
            key={provider}
            className="card-provider-icon"
            style={{ color: `var(--color-${provider}, var(--color-ink-3))` }}
            title={PROVIDER_LABELS[provider] ?? provider}
            aria-hidden="true"
          >
            <ProviderIcon provider={provider} size="sm" />
          </span>
        ))}
        <span>{providerLabel}</span>
        {episodeCount && (
          <>
            <span className="sep">·</span>
            <span>{episodeCount}</span>
          </>
        )}
        {secondary && (
          <>
            <span className="sep">·</span>
            <span>{secondary}</span>
          </>
        )}
        {item.progress != null && (
          <>
            <span className="sep">·</span>
            <span>{Math.round(item.progress)}%</span>
          </>
        )}
        {item.progress == null && remaining && (
          <>
            <span className="sep">·</span>
            <span>{remaining}</span>
          </>
        )}
      </p>
    </article>
  );
}
