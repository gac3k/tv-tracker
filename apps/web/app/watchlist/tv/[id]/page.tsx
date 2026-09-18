import Link from "next/link";
import { api } from "../../../../lib/server-api";
import { ShowSeasons } from "../../../../components/ShowSeasons";

export const dynamic = "force-dynamic";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tmdbId = Number(id);
  const show = Number.isInteger(tmdbId) && tmdbId > 0 ? await api.show(tmdbId) : null;

  if (!show) {
    return (
      <main id="main" className="shelf">
        <p className="crumb">
          <Link href="/watchlist">Watchlist</Link>
        </p>
        <div className="empty">
          Could not load this series. Check <code>TMDB_API_KEY</code> and that the title exists
          on TMDB.
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="shelf">
      <p className="crumb">
        <Link href="/watchlist">Watchlist</Link>
      </p>
      <header className="shelf-head show-head">
        {show.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, no loader needed
          <img className="show-poster" src={show.posterUrl} alt="" />
        ) : null}
        <div>
          <h1 className="shelf-title">{show.title}</h1>
          <p className="shelf-count">
            {show.seasons.length} seasons
            {show.following ? " · Followed" : ""}
          </p>
        </div>
      </header>
      <ShowSeasons show={show} />
    </main>
  );
}
