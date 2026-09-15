import { logger } from "../../logger";
import { ContentProvider } from "../decorate";
import { ProviderAuthenticationError, ProviderNetworkError } from "../errors";
import type {
  PlaybackObservation,
  ProviderSettings,
  ProviderStatus,
  SyncOptions,
  VodProvider,
} from "../provider";
import { JELLYFIN_PARSER_VERSION, parseJellyfinItem, type JellyfinItem } from "./parser";

const log = logger.child({ provider: "jellyfin" });

interface JellyfinUser {
  Id?: string;
  Name?: string;
}

@ContentProvider({
  id: "jellyfin",
  label: "Jellyfin",
  description: "Your own media server. Needs the server URL and an API key.",
  auth: "credentials",
  fields: [
    {
      key: "serverUrl",
      label: "Server URL",
      type: "url",
      required: true,
      placeholder: "https://jellyfin.example.com",
    },
    {
      key: "apiKey",
      label: "API key",
      type: "secret",
      required: true,
      help: "Dashboard → API Keys",
    },
    {
      key: "user",
      label: "User",
      type: "text",
      placeholder: "username or id",
      help: "Optional. Defaults to the first user the key can see.",
    },
  ],
  parserVersion: JELLYFIN_PARSER_VERSION,
})
export class JellyfinProvider implements VodProvider {
  readonly name = "jellyfin";
  private settings: ProviderSettings = { enabled: true, includeData: true, values: {} };

  applySettings(settings: ProviderSettings): void {
    this.settings = settings;
  }

  async login(): Promise<void> {
    const status = await this.isAuthenticated();
    if (!status.authenticated) {
      throw new ProviderAuthenticationError(
        this.name,
        "Jellyfin rejected the server URL or API key."
      );
    }
  }

  async isAuthenticated(): Promise<ProviderStatus> {
    const { serverUrl, apiKey } = this.creds();
    if (!serverUrl || !apiKey) {
      return { authenticated: false };
    }
    try {
      const user = await this.resolveUser(serverUrl, apiKey);
      return { authenticated: user != null, profileName: user?.Name };
    } catch {
      return { authenticated: false };
    }
  }

  async sync(_options: SyncOptions = {}): Promise<PlaybackObservation[]> {
    const { serverUrl, apiKey } = this.creds();
    if (!serverUrl || !apiKey) {
      throw new ProviderAuthenticationError(
        this.name,
        "Set the Jellyfin server URL and API key in Providers."
      );
    }
    const user = await this.resolveUser(serverUrl, apiKey);
    if (!user?.Id) {
      throw new ProviderAuthenticationError(this.name, "Could not resolve a Jellyfin user for this API key.");
    }

    const fields = "UserData,SeriesName,IndexNumber,ParentIndexNumber,RunTimeTicks";
    const [resume, played] = await Promise.all([
      this.get<{ Items?: JellyfinItem[] }>(
        serverUrl,
        apiKey,
        `/Users/${user.Id}/Items/Resume?IncludeItemTypes=Movie,Episode&Fields=${fields}&Limit=50`
      ),
      this.get<{ Items?: JellyfinItem[] }>(
        serverUrl,
        apiKey,
        `/Users/${user.Id}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Fields=${fields}&Limit=200`
      ),
    ]);

    const observedAt = new Date();
    const byId = new Map<string, PlaybackObservation>();
    for (const item of [...(resume.Items ?? []), ...(played.Items ?? [])]) {
      const obs = parseJellyfinItem(item, observedAt, user.Id);
      if (!obs) continue;
      const existing = byId.get(obs.providerContentId);
      if (!existing || (obs.progress ?? 0) > (existing.progress ?? 0)) {
        byId.set(obs.providerContentId, obs);
      }
    }
    const observations = [...byId.values()];
    log.info({ observations: observations.length, user: user.Name }, "jellyfin sync fetched");
    return observations;
  }

  private creds(): { serverUrl: string; apiKey: string; user: string } {
    return {
      serverUrl: normalizeServerUrl(this.settings.values.serverUrl ?? ""),
      apiKey: this.settings.values.apiKey ?? "",
      user: this.settings.values.user ?? "",
    };
  }

  private async resolveUser(serverUrl: string, apiKey: string): Promise<JellyfinUser | null> {
    const wanted = this.settings.values.user?.trim().toLowerCase();
    const users = await this.get<JellyfinUser[]>(serverUrl, apiKey, "/Users");
    if (!Array.isArray(users) || users.length === 0) return null;
    if (!wanted) return users[0] ?? null;
    return (
      users.find((u) => u.Id?.toLowerCase() === wanted || u.Name?.toLowerCase() === wanted) ?? null
    );
  }

  private async get<T>(serverUrl: string, apiKey: string, path: string): Promise<T> {
    const url = `${serverUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-Emby-Token": apiKey,
          Authorization: `MediaBrowser Client="vod-tracker", Device="vod-tracker", DeviceId="vod-tracker", Version="0.1.0", Token="${apiKey}"`,
        },
      });
    } catch (err) {
      throw new ProviderNetworkError(this.name, `Jellyfin request failed: ${url}`, { cause: err });
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthenticationError(this.name, "Jellyfin rejected the API key.");
    }
    if (!res.ok) {
      throw new ProviderNetworkError(this.name, `Jellyfin ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  }
}

function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}
