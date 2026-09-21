import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { AppChrome } from "../components/AppChrome";
import { api, getSession } from "../lib/server-api";
import "./globals.css";

export const metadata: Metadata = {
  title: "vod-tracker",
  description: "Local VOD watch-history tracker",
};

export const dynamic = "force-dynamic";

const THEME_BOOT =
  'try{var t=localStorage.getItem("vod-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);document.cookie="vod-theme="+t+";path=/;max-age=31536000;samesite=lax"}}catch(e){}';

const BARE = new Set(["/login", "/register"]);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const themeCookie = jar.get("vod-theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : undefined;
  const rail = jar.get("vod-rail")?.value === "collapsed" ? "collapsed" : "expanded";
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = BARE.has(path);

  const session = bare ? null : await getSession();
  const nowPlaying = bare ? null : await api.nowPlaying();
  const health = bare ? null : await api.health();

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {/*
          THESIS: Resume one title across every VOD — refuse the episode log as home.
          OWN-WORLD: Cool near-black paper, coral accent, poster catalogue, side-rail + top bar.
          STORY: Open, recognize the next title, jump back into the player.
          FIRST VIEWPORT: Seerr-style rail; Dashboard with Continue Watching and Watch Next rows.
          FORM: Catalogue + N3 side-rail. Extension of the incumbent dark shelf; no concept-seed.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {bare ? (
          children
        ) : (
          <AppChrome
            nowPlaying={nowPlaying}
            version={health?.version ?? null}
            userName={session?.user.username || session?.user.name || "You"}
            rail={rail}
          >
            {children}
          </AppChrome>
        )}
      </body>
    </html>
  );
}
