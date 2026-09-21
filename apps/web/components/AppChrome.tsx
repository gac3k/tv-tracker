"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NowPlaying } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { Icon, type IconName } from "./Icon";
import { OmniSearch } from "./OmniSearch";
import { ThemeToggle } from "./ThemeToggle";

const RAIL_KEY = "vod-rail";

const NAV: {
  href: string;
  label: string;
  short: string;
  icon: IconName;
  desktopOnly?: boolean;
  match: (path: string) => boolean;
}[] = [
  { href: "/", label: "Dashboard", short: "Home", icon: "home", match: (p) => p === "/" },
  { href: "/history", label: "History", short: "History", icon: "history", match: (p) => p === "/history" },
  {
    href: "/watchlist",
    label: "Watchlist",
    short: "List",
    icon: "device-tv",
    match: (p) => p === "/watchlist" || p.startsWith("/watchlist/"),
  },
  {
    href: "/untracked",
    label: "Not tracking",
    short: "Removed",
    icon: "eye-off",
    match: (p) => p === "/untracked",
  },
  {
    href: "/providers",
    label: "Providers",
    short: "Providers",
    icon: "apps",
    match: (p) => p === "/providers" || p.startsWith("/providers/"),
  },
  {
    href: "/system/jobs",
    label: "Jobs",
    short: "Jobs",
    icon: "list-details",
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
            title={item.label}
            aria-current={item.match(pathname) ? "page" : undefined}
          >
            <Icon name={item.icon} className="rail-icon" />
            <span className="rail-label-full">{item.label}</span>
            <span className="rail-label-short">{item.short}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}

function persistRail(next: "collapsed" | "expanded"): void {
  try {
    localStorage.setItem(RAIL_KEY, next);
  } catch {
    // private mode
  }
  document.cookie = `${RAIL_KEY}=${next};path=/;max-age=31536000;samesite=lax`;
}

function signOut() {
  void authClient.signOut({
    fetchOptions: { onSuccess: () => { window.location.href = "/login"; } },
  });
}

export function AppChrome({
  children,
  nowPlaying,
  version,
  userName,
  rail: initialRail = "expanded",
}: {
  children: React.ReactNode;
  nowPlaying: NowPlaying | null;
  version: string | null;
  userName: string;
  rail?: "collapsed" | "expanded";
}) {
  const playing = nowPlayingLabel(nowPlaying);
  const [rail, setRail] = useState(initialRail);
  const collapsed = rail === "collapsed";

  function toggleRail() {
    const next = collapsed ? "expanded" : "collapsed";
    setRail(next);
    persistRail(next);
  }

  return (
    <div className="app" data-rail={rail}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <div className="rail-head">
          <Link href="/" className="wordmark rail-brand">
            vod<span>·</span>tracker
          </Link>
          <button
            type="button"
            className="rail-toggle"
            onClick={toggleRail}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "layout-sidebar-left-expand" : "layout-sidebar-left-collapse"} className="rail-icon" />
          </button>
        </div>
        <AppNav />
        <div className="rail-foot">
          <div className="rail-user">
            <span className="rail-avatar" title={userName} aria-hidden="true">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="rail-user-meta">
              <span className="rail-user-name">{userName}</span>
              <button type="button" className="rail-user-sub rail-sign-out" onClick={signOut}>
                Sign out
              </button>
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
          <button type="button" className="button-ghost" onClick={signOut}>
            Sign out
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
