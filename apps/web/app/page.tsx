import type { LibraryCard, NowPlaying } from "../lib/api";
import { api } from "../lib/server-api";
import { splitDashboard } from "../lib/dashboard";
import { LibraryShelf } from "../components/LibraryShelf";
import { MediaTile, formatAirDate } from "../components/MediaTile";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function toApiQuery(params: SearchParams): string {
  const allowed = ["provider", "type", "sort"] as const;
  const search = new URLSearchParams();
  for (const key of allowed) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  search.set("view", "titles");
  search.set("status", "in_progress");
  search.set("limit", "300");
  return search.toString();
}

function pinNowPlaying(items: LibraryCard[], nowPlaying: NowPlaying | null): LibraryCard[] {
  if (!nowPlaying?.active) return items;
  const needle = (nowPlaying.content?.showTitle ?? nowPlaying.content?.title ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return items;
  const index = items.findIndex((item) => {
    const title = (item.showTitle ?? item.title ?? "").trim().toLowerCase();
    return title === needle;
  });
  if (index <= 0) return items;
  const next = items.slice();
  const [hit] = next.splice(index, 1);
  return [hit!, ...next];
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [library, nowPlaying, upcoming] = await Promise.all([
    api.library(toApiQuery(params)),
    api.nowPlaying(),
    api.upcoming(),
  ]);

  if (!library) {
    return (
      <main id="main" className="shelf">
        <div className="empty">
          API server unreachable. Start it with <code>pnpm dev:server</code> (port 3000).
        </div>
      </main>
    );
  }

  const { continueWatching, watchNext } = splitDashboard(
    pinNowPlaying(library.items, nowPlaying)
  );

  return (
    <main id="main" className="shelf dash">
      <header className="shelf-head">
        <h1 className="shelf-title">Dashboard</h1>
      </header>

      {!library.artworkEnabled && (
        <p className="hint">
          No artwork: set <code>TMDB_API_KEY</code> in <code>apps/server/.env</code> to pull
          posters and episode runtimes from TMDB. Titles still work without it.
        </p>
      )}

      <section className="dash-row" aria-labelledby="continue-heading">
        <header className="dash-row-head">
          <h2 id="continue-heading">Continue Watching</h2>
          <p className="shelf-count">{continueWatching.length}</p>
        </header>
        <LibraryShelf
          layout="row"
          items={continueWatching}
          empty={
            <div className="empty empty-row">
              Nothing in progress. Sync a provider to pick up titles you are mid-watch.
            </div>
          }
        />
      </section>

      <section className="dash-row" aria-labelledby="next-heading">
        <header className="dash-row-head">
          <h2 id="next-heading">Watch Next</h2>
          <p className="shelf-count">{watchNext.length}</p>
        </header>
        <LibraryShelf
          layout="row"
          items={watchNext}
          empty={
            <div className="empty empty-row">
              Finish an episode and the next one in that series will land here.
            </div>
          }
        />
      </section>

      <section className="dash-row" aria-labelledby="upcoming-heading">
        <header className="dash-row-head">
          <h2 id="upcoming-heading">Upcoming</h2>
          <p className="shelf-count">{upcoming?.items.length ?? 0}</p>
        </header>
        {upcoming?.tmdbEnabled === false ? (
          <p className="hint">
            Upcoming premieres need <code>TMDB_API_KEY</code> in <code>apps/server/.env</code>.
          </p>
        ) : !upcoming?.items.length ? (
          <div className="empty empty-row">
            No upcoming premieres or new seasons among titles you watch or follow.
          </div>
        ) : (
          <div className="poster-row">
            {upcoming.items.map((item) => (
              <MediaTile
                key={`${item.tmdbType}:${item.tmdbId}`}
                title={item.title}
                posterUrl={item.posterUrl}
                badge={item.kind === "movie" ? "Film" : item.kind === "series" ? "Series" : "Season"}
                subtitle={`${item.subtitle} · ${formatAirDate(item.airDate)}`}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
