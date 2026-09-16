import { api } from "../../lib/api";
import { ProviderPanel } from "../../components/ProviderPanel";

export const dynamic = "force-dynamic";

export default async function ProvidersLayout({ children }: { children: React.ReactNode }) {
  const catalog = await api.providers();

  if (!catalog) {
    return (
      <main id="main" className="shelf">
        <div className="empty">
          API server unreachable. Start it with <code>pnpm dev:server</code> (port 3000).
        </div>
        {children}
      </main>
    );
  }

  const sources = catalog.providers.filter((item) => item.kind !== "plugin");
  const plugins = catalog.providers.filter((item) => item.kind === "plugin");

  return (
    <main id="main" className="shelf">
      <section className="provider-section">
        <header className="shelf-head">
          <h1 className="shelf-title">Providers</h1>
          <p className="shelf-count">{sources.length} registered</p>
        </header>
        <p className="shelf-lede">
          Turn sync and library data on or off independently. Browser services sign in here; Jellyfin
          uses a settings form.
        </p>
        <div className="provider-list">
          {sources.map((item) => (
            <ProviderPanel key={item.id} item={item} />
          ))}
        </div>
      </section>
      {plugins.length > 0 && (
        <section className="provider-section">
          <header className="shelf-head">
            <h2 className="shelf-title">Plugins</h2>
            <p className="shelf-count">{plugins.length} registered</p>
          </header>
          <p className="shelf-lede">
            JustWatch marks watched titles after a sync or when you mark an episode watched. MCP
            exposes a tool so Assist can resolve a title to a webOS app id and content link, then
            launch it on the TV.
          </p>
          <div className="provider-list">
            {plugins.map((item) => (
              <ProviderPanel key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {children}
    </main>
  );
}
