import { ExtensionToken } from "../../components/ExtensionToken";
import { api } from "../../lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const extension = await api.extension();

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
    </main>
  );
}
