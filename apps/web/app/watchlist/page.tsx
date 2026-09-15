import { api } from "../../lib/api";
import { WatchlistTable } from "../../components/WatchlistTable";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const shows = await api.shows();

  if (!shows) {
    return (
      <main id="main" className="shelf">
        <div className="empty">
          API server unreachable. Start it with <code>pnpm dev:server</code> (port 3000).
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="shelf">
      <header className="shelf-head">
        <h1 className="shelf-title">Watchlist</h1>
        <p className="shelf-count">{shows.items.length}</p>
      </header>
      <p className="shelf-lede">
        Series you are watching, plus titles you follow. Search in the top bar to add more. Catch
        up marks every aired episode watched; open a series to tick seasons or one episode at a
        time.
      </p>
      {shows.items.length === 0 ? (
        <div className="empty">
          Nothing here yet. Sync a provider or search in the top bar to follow a title.
        </div>
      ) : (
        <WatchlistTable items={shows.items} tmdbEnabled={shows.tmdbEnabled !== false} />
      )}
    </main>
  );
}
