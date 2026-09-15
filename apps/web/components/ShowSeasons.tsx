"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatAirDate } from "./MediaTile";
import { showProgress, type ShowCatalog } from "../lib/api";

function hueFor(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

export function ShowSeasons({ show }: { show: ShowCatalog }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const openAt = show.seasons.findIndex((season) => season.watched < season.total);

  async function run(
    key: string,
    body: { mark: "season" | "episode" | "caught_up"; season?: number; episode?: number; watched?: boolean }
  ) {
    if (busy) return;
    setBusy(key);
    try {
      await showProgress("tv", show.tmdbId, body);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const airedUnwatched = show.seasons.some((season) =>
    season.episodes.some((ep) => ep.aired && !ep.watched)
  );

  return (
    <div className="show-seasons">
      {airedUnwatched && (
        <div className="shelf-toolbar">
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            onClick={() => void run("catch", { mark: "caught_up" })}
          >
            Catch up aired episodes
          </button>
        </div>
      )}

      {show.seasons.map((season, index) => (
        <section key={season.seasonNumber} className="show-season">
          <div className="show-season-actions">
            {season.watched < season.total ? (
              <button
                type="button"
                className="button-ghost"
                disabled={busy !== null}
                onClick={() =>
                  void run(`s${season.seasonNumber}`, {
                    mark: "season",
                    season: season.seasonNumber,
                    watched: true,
                  })
                }
              >
                Mark watched
              </button>
            ) : season.userMarked ? (
              <button
                type="button"
                className="button-ghost"
                disabled={busy !== null}
                onClick={() =>
                  void run(`s${season.seasonNumber}`, {
                    mark: "season",
                    season: season.seasonNumber,
                    watched: false,
                  })
                }
              >
                Unmark
              </button>
            ) : (
              <span className="data-sub">Watched</span>
            )}
          </div>
          <details open={openAt < 0 ? index === 0 : index === openAt}>
            <summary>
              <span className="show-season-name">{season.name}</span>
              <span className="show-season-count">
                {season.watched}/{season.total} watched
              </span>
            </summary>
            <ul className="show-episodes">
            {season.episodes.map((ep) => {
              const label = `S${season.seasonNumber}·E${ep.episodeNumber}`;
              return (
                <li key={ep.episodeNumber} className="show-episode">
                  <label className="show-episode-mark">
                    <input
                      type="checkbox"
                      checked={ep.watched}
                      disabled={ep.locked || busy !== null}
                      aria-label={
                        ep.locked ? `${label} watched in library` : `Mark ${label} watched`
                      }
                      onChange={() =>
                        void run(`${season.seasonNumber}:${ep.episodeNumber}`, {
                          mark: "episode",
                          season: season.seasonNumber,
                          episode: ep.episodeNumber,
                          watched: !ep.watched,
                        })
                      }
                    />
                  </label>
                  <div className="data-still">
                    {ep.stillUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
                      <img src={ep.stillUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <div
                        className="poster-fallback"
                        style={{ ["--fallback-a" as string]: `oklch(30% 0.06 ${hueFor(ep.name)})` }}
                      />
                    )}
                  </div>
                  <div className="show-episode-meta">
                    <div className="data-title">
                      {label} · {ep.name}
                    </div>
                    <div className="data-sub">
                      {ep.airDate ? formatAirDate(ep.airDate) : "No air date"}
                      {ep.locked ? " · In library" : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          </details>
        </section>
      ))}
    </div>
  );
}
