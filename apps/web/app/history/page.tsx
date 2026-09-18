import { Suspense } from "react";
import { api } from "../../lib/server-api";
import { FilterBar } from "../../components/FilterBar";
import { HistoryTable } from "../../components/HistoryTable";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function toApiQuery(params: SearchParams): string {
  const allowed = ["provider", "type", "status", "q", "sort"] as const;
  const search = new URLSearchParams();
  for (const key of allowed) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  search.set("view", "episodes");
  search.set("limit", "300");
  return search.toString();
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const library = await api.library(toApiQuery(params));

  if (!library) {
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
        <h1 className="shelf-title">Watch history</h1>
        <p className="shelf-count">{library.total} plays</p>
      </header>

      {!library.artworkEnabled && (
        <p className="hint">
          No artwork: set <code>TMDB_API_KEY</code> in <code>apps/server/.env</code> to pull
          posters and episode runtimes from TMDB. Titles still work without it.
        </p>
      )}

      <Suspense fallback={null}>
        <FilterBar
          basePath="/history"
          facets={library.facets}
          total={library.total}
          shown={library.items.length}
          noun="plays"
        />
      </Suspense>

      {library.items.length === 0 ? (
        <div className="empty">
          No watch history yet. Sync a provider in the sidebar to pull it in.
        </div>
      ) : (
        <HistoryTable items={library.items} />
      )}
    </main>
  );
}
