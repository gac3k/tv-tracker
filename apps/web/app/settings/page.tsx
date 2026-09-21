import { ConfigYamlEditor } from "../../components/ConfigYamlEditor";
import { ExtensionToken } from "../../components/ExtensionToken";
import { api } from "../../lib/server-api";

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
        <h2 className="shelf-title">Config</h2>
      </header>
      <p className="shelf-lede">
        App settings live in YAML. MCP defaults to on. Assist deeplinks use <code>tv.os</code>{" "}
        (<code>webos</code> or <code>android</code>). Set <code>homeassistant.mqtt_url</code> to
        publish a TV Tracker device with a Last Watched sensor via MQTT discovery.{" "}
        <code>TMDB_API_KEY</code>, <code>MCP_ENABLED</code>, <code>TV_OS</code>, and{" "}
        <code>MQTT_URL</code> override the file when set.
      </p>
      <ConfigYamlEditor yaml={settings?.yaml ?? ""} envLocks={settings?.envLocks ?? []} />
    </main>
  );
}
