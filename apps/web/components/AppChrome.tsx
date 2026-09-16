"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NowPlaying } from "../lib/api";
import { OmniSearch } from "./OmniSearch";
import { ThemeToggle } from "./ThemeToggle";

type IconName =
  | "dashboard"
  | "history"
  | "watchlist"
  | "untracked"
  | "providers"
  | "jobs"
  | "settings";

function RailIcon({ name }: { name: IconName }) {
  return (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "dashboard" && (
        <>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </>
      )}
      {name === "history" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5l3 2" />
        </>
      )}
      {name === "watchlist" && (
        <>
          <path d="M6 4h12v16l-6-3.5L6 20V4z" />
        </>
      )}
      {name === "untracked" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M8 8l8 8M16 8l-8 8" />
        </>
      )}
      {name === "providers" && (
        <>
          <path d="M12 4 4 8l8 4 8-4-8-4z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </>
      )}
      {name === "jobs" && <path d="M22 12h-4l-3 7-6-14-3 7H2" />}
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5" />
        </>
      )}
    </svg>
  );
}

const NAV: {
  href: string;
  label: string;
  short: string;
  icon: IconName;
  desktopOnly?: boolean;
  match: (path: string) => boolean;
}[] = [
  { href: "/", label: "Dashboard", short: "Home", icon: "dashboard", match: (p) => p === "/" },
  { href: "/history", label: "History", short: "History", icon: "history", match: (p) => p === "/history" },
  {
    href: "/watchlist",
    label: "Watchlist",
    short: "List",
    icon: "watchlist",
    match: (p) => p === "/watchlist" || p.startsWith("/watchlist/"),
  },
  {
    href: "/untracked",
    label: "Not tracking",
    short: "Removed",
    icon: "untracked",
    match: (p) => p === "/untracked",
  },
  {
    href: "/providers",
    label: "Providers",
    short: "Providers",
    icon: "providers",
    match: (p) => p === "/providers" || p.startsWith("/providers/"),
  },
  {
    href: "/system/jobs",
    label: "Jobs",
    short: "Jobs",
    icon: "jobs",
    match: (p) => p.startsWith("/system"),
  },
  {
    href: "/settings",
    label: "Settings",
    short: "Settings",
    icon: "settings",
    desktopOnly: true,
    match: (p) => p === "/settings" || p.startsWith("/settings/"),
  },
];

function nowPlayingLabel(nowPlaying: NowPlaying | null): string | null {
  if (!nowPlaying?.active) return null;
  return [
    nowPlaying.content?.showTitle ?? nowPlaying.content?.title,
    nowPlaying.content?.showTitle ? nowPlaying.content?.title : null,
    nowPlaying.progress != null ? `${Math.round(nowPlaying.progress)}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="rail-nav" aria-label="Library">
      {NAV.map((item, index) => (
        <span key={item.href} className="rail-slot">
          {index === 4 && <span className="rail-split" aria-hidden="true" />}
          <Link
            href={item.href}
            className={item.desktopOnly ? "rail-link rail-desktop-only" : "rail-link"}
            aria-current={item.match(pathname) ? "page" : undefined}
          >
            <RailIcon name={item.icon} />
            <span className="rail-label-full">{item.label}</span>
            <span className="rail-label-short">{item.short}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function AppChrome({
  children,
  nowPlaying,
  version,
}: {
  children: React.ReactNode;
  nowPlaying: NowPlaying | null;
  version: string | null;
}) {
  const playing = nowPlayingLabel(nowPlaying);

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <Link href="/" className="wordmark rail-brand">
          vod<span>·</span>tracker
        </Link>
        <AppNav />
        <div className="rail-foot">
          <div className="rail-user" title="Account settings — coming later">
            <span className="rail-avatar" aria-hidden="true">
              Y
            </span>
            <span className="rail-user-meta">
              <span className="rail-user-name">You</span>
              <span className="rail-user-sub">Local</span>
            </span>
          </div>
          {version && (
            <p className="rail-version" title="Deployed app version">
              {version}
            </p>
          )}
        </div>
      </aside>
      <div className="frame">
        <header className="topbar">
          <Link href="/" className="wordmark top-brand">
            vod<span>·</span>tracker
          </Link>
          <p className="now-playing">
            {playing ? (
              <>
                <span className="dot" data-state="ok" aria-hidden="true" />
                <span>
                  Now <span className="now-title">{playing}</span>
                </span>
              </>
            ) : (
              <span>Nothing playing</span>
            )}
          </p>
          <OmniSearch />
          <ThemeToggle />
        </header>
        {children}
      </div>
    </div>
  );
}
