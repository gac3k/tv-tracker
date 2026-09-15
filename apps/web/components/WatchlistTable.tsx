"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROVIDER_LABELS, showProgress, type ShowListItem } from "../lib/api";
import { ProviderIcon } from "./ProviderIcon";

function hueFor(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

function sourceLabel(item: ShowListItem): string {
  const watching = item.sources.includes("library");
  const followed = item.sources.includes("watchlist");
  if (watching && followed) return "Watching · Followed";
  if (watching) return "Watching";
  return "Followed";
}

export function WatchlistTable({
  items,
  tmdbEnabled = true,
}: {
  items: ShowListItem[];
  tmdbEnabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(item: ShowListItem, mark: "caught_up" | "watched") {
    if (!item.tmdbId || !item.tmdbType || busy) return;
    const key = item.key;
    setBusy(key);
    try {
      await showProgress(item.tmdbType, item.tmdbId, { mark });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="data-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-col-poster">Poster</th>
            <th>Title</th>
            <th className="data-col-progress">Progress</th>
            <th className="data-col-provider">Providers</th>
            <th className="data-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const href =
              item.tmdbType === "tv" && item.tmdbId ? `/watchlist/tv/${item.tmdbId}` : null;
            const title = href ? (
              <Link href={href} className="data-link">
                {item.title}
              </Link>
            ) : (
              item.title
            );
            return (
              <tr key={item.key}>
                <td className="data-col-poster">
                  {href ? (
                    <Link href={href} className="data-poster">
                      <Poster src={item.posterUrl} title={item.title} />
                    </Link>
                  ) : (
                    <div className="data-poster">
                      <Poster src={item.posterUrl} title={item.title} />
                    </div>
                  )}
                </td>
                <td>
                  <div className="data-title">{title}</div>
                  <div className="data-sub">
                    {item.progress ?? sourceLabel(item)}
                    {item.tmdbType === "movie" ? " · Film" : ""}
                  </div>
                </td>
                <td className="data-col-progress">{item.progress ?? sourceLabel(item)}</td>
                <td className="data-col-provider">
                  {item.providers.length ? (
                    <span className="data-providers">
                      {item.providers.map((provider) => (
                        <ProviderIcon key={provider} provider={provider} size="sm" />
                      ))}
                      <span className="data-sub">
                        {item.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")}
                      </span>
                    </span>
                  ) : (
                    <span className="data-sub">—</span>
                  )}
                </td>
                <td className="data-col-actions">
                  {item.canCatchUp && tmdbEnabled && item.tmdbId && item.tmdbType === "tv" ? (
                    <button
                      type="button"
                      className="button-ghost"
                      disabled={busy === item.key}
                      onClick={() => void run(item, "caught_up")}
                    >
                      Catch up
                    </button>
                  ) : item.tmdbType === "movie" && item.tmdbId ? (
                    <button
                      type="button"
                      className="button-ghost"
                      disabled={busy === item.key}
                      onClick={() => void run(item, "watched")}
                    >
                      Mark watched
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Poster({ src, title }: { src: string | null; title: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
      <img src={src} alt="" loading="lazy" decoding="async" />
    );
  }
  return (
    <div
      className="poster-fallback"
      style={{ ["--fallback-a" as string]: `oklch(30% 0.06 ${hueFor(title)})` }}
    />
  );
}
