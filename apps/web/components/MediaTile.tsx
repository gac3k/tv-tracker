import Link from "next/link";
import type { ReactNode } from "react";

function hueFor(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

export function MediaTile({
  title,
  posterUrl,
  subtitle,
  badge,
  action,
  href,
}: {
  title: string;
  posterUrl: string | null;
  subtitle?: string | null;
  badge?: string | null;
  action?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="poster-slot">
        <div className="poster">
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
            <img src={posterUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <div
              className="poster-fallback"
              style={{ ["--fallback-a" as string]: `oklch(30% 0.06 ${hueFor(title)})` }}
            >
              <span>{title}</span>
            </div>
          )}
          {badge && <span className="badge">{badge}</span>}
        </div>
        {action}
      </div>
      <h3 className="card-title" title={title}>
        {title}
      </h3>
      {subtitle && <p className="card-sub">{subtitle}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card">
        {body}
      </Link>
    );
  }

  return <article className="card">{body}</article>;
}

export function formatAirDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
