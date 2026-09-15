"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { libraryAction, type LibraryCard } from "../lib/api";
import { PosterCard } from "./PosterCard";

export function LibraryShelf({
  items,
  empty,
  mode = "library",
  layout = "grid",
}: {
  items: LibraryCard[];
  empty: ReactNode;
  mode?: "library" | "removed";
  layout?: "grid" | "row";
}) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function run(action: "watched" | "hidden" | "restore", keys: string[]) {
    if (!keys.length || busy) return;
    setBusy(true);
    try {
      await libraryAction(action, keys);
      setSelected(new Set());
      setSelecting(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const picked = items.filter((item) => selected.has(item.key)).map((item) => item.key);
  const row = layout === "row";

  return (
    <>
      {items.length > 0 && !row && (
        <div className="shelf-toolbar">
          <button
            type="button"
            className="button-ghost"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((on) => !on);
              setSelected(new Set());
            }}
          >
            {selecting ? "Cancel" : "Select"}
          </button>
          {selecting && (
            <button
              type="button"
              className="button-ghost"
              onClick={() => setSelected(new Set(items.map((item) => item.key)))}
            >
              Select all
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        empty
      ) : (
        <div className={row ? "poster-row" : "grid"}>
          {items.map((item) => (
            <PosterCard
              key={item.key}
              item={item}
              mode={mode}
              selecting={row ? false : selecting}
              selected={selected.has(item.key)}
              onToggleSelect={row ? undefined : () => toggle(item.key)}
              onAction={row ? undefined : (action, key) => void run(action, [key])}
            />
          ))}
        </div>
      )}

      {!row && selecting && picked.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-count">
            {picked.length} selected
          </span>
          {mode === "removed" ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void run("restore", picked)}
            >
              Restore to tracking
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void run("watched", picked)}
              >
                Mark as Watched
              </button>
              <button
                type="button"
                className="button-ghost"
                disabled={busy}
                onClick={() => void run("hidden", picked)}
              >
                Remove from tracking
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
