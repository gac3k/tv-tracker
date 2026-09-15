"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { watchlistAdd, type CatalogHit, type ShowListItem } from "../lib/api";

type Hit = {
  key: string;
  title: string;
  posterUrl: string | null;
  posterPath?: string | null;
  tmdbId: number | null;
  tmdbType: "tv" | "movie" | null;
  owned: boolean;
  href: string | null;
  detail: string;
};

export function OmniSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const showsRef = useRef<ShowListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [tmdbEnabled, setTmdbEnabled] = useState(true);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (pathname.startsWith("/login")) return null;

  function search(value: string) {
    setQuery(value);
    window.clearTimeout((window as unknown as { __vodOmni?: number }).__vodOmni);
    (window as unknown as { __vodOmni?: number }).__vodOmni = window.setTimeout(() => {
      const q = value.trim();
      if (!q) {
        setHits([]);
        setOpen(false);
        return;
      }
      startTransition(() => {
        void runSearch(q);
      });
    }, 300);
  }

  async function runSearch(q: string) {
    const needle = q.toLowerCase();
    const shows = await loadShows(showsRef);
    const allOwned = shows.map(fromShow);
    const ownedKeys = new Set(allOwned.map((item) => item.key));
    const owned = allOwned.filter((item) => item.title.toLowerCase().includes(needle));
    let catalog: Hit[] = [];
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
      const data = res.ok ? ((await res.json()) as { items?: CatalogHit[]; tmdbEnabled?: boolean }) : null;
      setTmdbEnabled(data?.tmdbEnabled !== false);
      catalog = (data?.items ?? [])
        .map(fromCatalog)
        .filter((item) => !ownedKeys.has(item.key));
    } catch {
      setTmdbEnabled(false);
    }
    const next = [...owned, ...catalog].slice(0, 12);
    setHits(next);
    setActive(0);
    setOpen(true);
  }

  async function follow(hit: Hit) {
    if (!hit.tmdbId || !hit.tmdbType || busy) return;
    setBusy(hit.key);
    try {
      await watchlistAdd({
        tmdbType: hit.tmdbType,
        tmdbId: hit.tmdbId,
        title: hit.title,
        posterPath: hit.posterPath ?? null,
      });
      showsRef.current = null;
      setHits((prev) =>
        prev.map((item) =>
          item.key === hit.key
            ? { ...item, owned: true, href: hrefFor(hit.tmdbType, hit.tmdbId, true) }
            : item
        )
      );
      router.refresh();
      if (hit.tmdbType === "tv") {
        setOpen(false);
        router.push(`/watchlist/tv/${hit.tmdbId}`);
      }
    } finally {
      setBusy(null);
    }
  }

  function go(hit: Hit) {
    if (hit.href) {
      setOpen(false);
      router.push(hit.href);
      return;
    }
    void follow(hit);
  }

  return (
    <div ref={rootRef} className="omni">
      <input
        className="search top-search"
        type="search"
        value={query}
        placeholder="Search titles"
        aria-label="Search your list and TMDB"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        data-pending={pending ? "true" : undefined}
        onChange={(event) => search(event.currentTarget.value)}
        onFocus={() => {
          if (hits.length) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!open || hits.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const hit = hits[active];
            if (hit) go(hit);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} className="omni-panel" role="listbox">
          {hits.length === 0 && !pending ? (
            <li className="omni-empty">
              {tmdbEnabled ? "No titles match that search." : "No local matches. Set TMDB_API_KEY to search the catalog."}
            </li>
          ) : (
            hits.map((hit, index) => (
              <li key={hit.key} role="option" aria-selected={index === active}>
                {hit.owned && hit.href ? (
                  <Link
                    href={hit.href}
                    className="omni-hit"
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(index)}
                  >
                    <Thumb url={hit.posterUrl} title={hit.title} />
                    <span className="omni-meta">
                      <span className="data-title">{hit.title}</span>
                      <span className="data-sub">{hit.detail}</span>
                    </span>
                  </Link>
                ) : (
                  <div
                    className="omni-hit"
                    onMouseEnter={() => setActive(index)}
                  >
                    <Thumb url={hit.posterUrl} title={hit.title} />
                    <span className="omni-meta">
                      <span className="data-title">{hit.title}</span>
                      <span className="data-sub">{hit.detail}</span>
                    </span>
                    {hit.tmdbId && hit.tmdbType ? (
                      <button
                        type="button"
                        className="button-ghost"
                        disabled={busy === hit.key}
                        onClick={() => void follow(hit)}
                      >
                        Follow
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function hrefFor(
  tmdbType: "tv" | "movie" | null,
  tmdbId: number | null,
  owned: boolean
): string | null {
  if (tmdbType === "tv" && tmdbId) return `/watchlist/tv/${tmdbId}`;
  if (owned) return "/watchlist";
  return null;
}

function fromShow(item: ShowListItem): Hit {
  const key =
    item.tmdbId && item.tmdbType ? `${item.tmdbType}:${item.tmdbId}` : item.key;
  return {
    key,
    title: item.title,
    posterUrl: item.posterUrl,
    tmdbId: item.tmdbId,
    tmdbType: item.tmdbType,
    owned: true,
    href: hrefFor(item.tmdbType, item.tmdbId, true),
    detail: item.progress
      ? `${item.tmdbType === "movie" ? "Film" : "Series"} · ${item.progress}`
      : item.tmdbType === "movie"
        ? "Film · On your list"
        : "Series · On your list",
  };
}

function fromCatalog(hit: CatalogHit): Hit {
  return {
    key: `${hit.tmdbType}:${hit.tmdbId}`,
    title: hit.title,
    posterUrl: hit.posterUrl,
    posterPath: hit.posterPath,
    tmdbId: hit.tmdbId,
    tmdbType: hit.tmdbType,
    owned: hit.onWatchlist,
    href: hrefFor(hit.tmdbType, hit.tmdbId, hit.onWatchlist),
    detail: [hit.tmdbType === "tv" ? "Series" : "Movie", hit.year, hit.onWatchlist ? "On your list" : "Catalog"]
      .filter(Boolean)
      .join(" · "),
  };
}

async function loadShows(ref: { current: ShowListItem[] | null }): Promise<ShowListItem[]> {
  if (ref.current) return ref.current;
  try {
    const res = await fetch("/api/shows");
    const data = res.ok ? ((await res.json()) as { items?: ShowListItem[] }) : null;
    ref.current = data?.items ?? [];
  } catch {
    ref.current = [];
  }
  return ref.current;
}

function Thumb({ url, title }: { url: string | null; title: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
      <img className="omni-thumb" src={url} alt="" />
    );
  }
  return <span className="omni-thumb omni-thumb-empty" aria-hidden="true" title={title} />;
}
