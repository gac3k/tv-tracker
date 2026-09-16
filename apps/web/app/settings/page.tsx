import { ExtensionToken } from "../../components/ExtensionToken";
import { TmdbSettings } from "../../components/TmdbSettings";
import { api } from "../../lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const extension = await api.extension();
  const settings = await api.settings();

  return (
    <main id="main" className="shelf">
      <header className="shelf-head">
        <h1 className="shelf-title">Settings</h1>
      </header>
      <p className="shelf-lede">
        Import a provider login from the Firefox extension instead of the remote browser console.
        Sign in to Netflix (or another VOD) in Firefox, then save the session from the extension
        popup.
      </p>
      <ExtensionToken token={extension?.token ?? null} />
      <header className="shelf-head shelf-head-plugins">
        <h2 className="shelf-title">TMDB</h2>
      </header>
      <p className="shelf-lede">
        Optional. Posters, catalog search, and upcoming episodes need a free key from
        themoviedb.org.
      </p>
      <TmdbSettings
        set={settings?.tmdbApiKeySet ?? false}
        source={settings?.tmdbApiKeySource ?? null}
      />
    </main>
  );
}
