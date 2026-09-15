"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PROVIDER_LABELS, type LibraryResponse } from "../lib/api";
import { ProviderIcon } from "./ProviderIcon";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Watched" },
  { value: "unwatched", label: "No progress" },
];

const TYPES = [
  { value: "", label: "All" },
  { value: "episode", label: "Episodes" },
  { value: "movie", label: "Movies" },
];

const SORTS = [
  { value: "recent", label: "Recently watched" },
  { value: "progress", label: "Progress" },
  { value: "title", label: "Title A→Z" },
];

export function FilterBar({
  facets,
  total,
  shown,
  basePath = "/",
  hideStatus = false,
  noun = "titles",
}: {
  facets: LibraryResponse["facets"];
  total: number;
  shown: number;
  basePath?: string;
  hideStatus?: boolean;
  noun?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const selectedProviders = (params.get("provider") ?? "").split(",").filter(Boolean);
  const status = params.get("status") ?? "all";
  const type = params.get("type") ?? "";
  const sort = params.get("sort") ?? "recent";
  const q = params.get("q") ?? "";

  function apply(next: URLSearchParams) {
    startTransition(() => {
      const query = next.toString();
      router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
    });
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    apply(next);
  }

  function toggleProvider(provider: string) {
    const next = new URLSearchParams(params.toString());
    const selected = new Set(selectedProviders);
    if (selected.has(provider)) {
      selected.delete(provider);
    } else {
      selected.add(provider);
    }
    if (selected.size) {
      next.set("provider", [...selected].join(","));
    } else {
      next.delete("provider");
    }
    apply(next);
  }

  const hasFilters =
    selectedProviders.length > 0 || (!hideStatus && status !== "all") || type !== "" || q !== "";

  return (
    <div className="filters">
      <div className="chip-row" role="group" aria-label="Filter by provider">
        {facets.providers.map(({ provider, count }) => {
          const active = selectedProviders.includes(provider);
          return (
            <button
              key={provider}
              type="button"
              className="chip"
              aria-pressed={active}
              onClick={() => toggleProvider(provider)}
            >
              <span
                className="chip-icon"
                style={{ color: `var(--color-${provider}, var(--color-ink-3))` }}
                aria-hidden="true"
              >
                <ProviderIcon provider={provider} size="sm" />
              </span>
              {PROVIDER_LABELS[provider] ?? provider}
              <span className="count">{count}</span>
            </button>
          );
        })}
      </div>

      <select
        className="select"
        value={type}
        aria-label="Media type"
        onChange={(event) => setParam("type", event.currentTarget.value)}
      >
        {TYPES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {!hideStatus && (
        <select
          className="select"
          value={status}
          aria-label="Watch status"
          onChange={(event) => setParam("status", event.currentTarget.value)}
        >
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      <select
        className="select"
        value={sort}
        aria-label="Sort order"
        onChange={(event) => setParam("sort", event.currentTarget.value)}
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="filters-meta">
        <span aria-live="polite">
          {pending ? "Filtering…" : `${shown} of ${total} ${noun}`}
        </span>
        {hasFilters && (
          <button type="button" className="reset" onClick={() => apply(new URLSearchParams())}>
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
