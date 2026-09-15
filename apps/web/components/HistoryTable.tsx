import { PROVIDER_LABELS, type LibraryCard } from "../lib/api";
import { ProviderIcon } from "./ProviderIcon";

function hueFor(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

function episodeLabel(item: LibraryCard): string {
  if (item.mediaType === "movie") return "Film";
  if (item.seasonNumber == null || item.episodeNumber == null) return "Episode";
  return `S${item.seasonNumber}·E${item.episodeNumber}`;
}

function progressLabel(item: LibraryCard): string {
  if (item.completed) return "Watched";
  if (item.progress != null) return `${Math.round(item.progress)}%`;
  return "—";
}

function whenLabel(item: LibraryCard): string {
  const raw = item.watchedAt ?? item.observedAt;
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryTable({ items }: { items: LibraryCard[] }) {
  return (
    <div className="data-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-col-still">Still</th>
            <th>Title</th>
            <th className="data-col-episode">Episode</th>
            <th className="data-col-provider">Provider</th>
            <th className="data-col-progress">Progress</th>
            <th className="data-col-when">Watched</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const heading = item.showTitle ?? item.title ?? item.providerContentId;
            const secondary = item.showTitle ? item.title : null;
            const thumb = item.artwork?.stillUrl ?? item.artwork?.posterUrl ?? null;
            const provider = PROVIDER_LABELS[item.provider] ?? item.provider;
            return (
              <tr key={item.key}>
                <td className="data-col-still">
                  <div className="data-still">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
                      <img src={thumb} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <div
                        className="poster-fallback"
                        style={{ ["--fallback-a" as string]: `oklch(30% 0.06 ${hueFor(heading)})` }}
                      />
                    )}
                  </div>
                </td>
                <td>
                  <div className="data-title">{heading}</div>
                  {secondary && <div className="data-sub">{secondary}</div>}
                  <div className="data-sub data-sub-mobile">
                    {episodeLabel(item)} · {whenLabel(item)}
                  </div>
                </td>
                <td className="data-col-episode">{episodeLabel(item)}</td>
                <td className="data-col-provider">
                  <span className="data-provider">
                    <ProviderIcon provider={item.provider} size="sm" />
                    {provider}
                  </span>
                </td>
                <td className="data-col-progress">{progressLabel(item)}</td>
                <td className="data-col-when">{whenLabel(item)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
