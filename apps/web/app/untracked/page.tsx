import { Suspense } from "react";
import { api } from "../../lib/server-api";
import { FilterBar } from "../../components/FilterBar";
import { LibraryShelf } from "../../components/LibraryShelf";

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
  search.set("tracking", "removed");
  search.set("limit", "300");
  return search.toString();
}

export default async function UntrackedPage({
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
        <h1 className="shelf-title">Not tracking</h1>
        <p className="shelf-count">{library.total} titles</p>
      </header>

      <Suspense fallback={null}>
        <FilterBar
          basePath="/untracked"
          facets={library.facets}
          total={library.total}
          shown={library.items.length}
        />
      </Suspense>

      <LibraryShelf
        items={library.items}
        mode="removed"
        empty={
          <div className="empty">
            Nothing removed from tracking. Use the menu on a poster to hide a title from Watching
            and History.
          </div>
        }
      />
    </main>
  );
}
