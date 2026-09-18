/**
 * Deep links back to the content in each provider's web player.
 *
 * Every pattern below was verified against the live services: a valid id
 * resolves (Apple even redirects an id-only URL to its canonical slug URL,
 * and 404s on a bogus id), so no extra scraping is needed — the provider
 * content id we already store is enough.
 */
export function providerUrl(
  provider: string,
  providerContentId: string,
  mediaType: string,
  extras?: { jellyfinServerUrl?: string }
): string | null {
  const id = providerContentId?.trim();
  if (!id) return null;

  switch (provider) {
    case "netflix":
      // Numeric video id; /watch/ resolves for both episodes and films.
      return /^\d+$/.test(id) ? `https://www.netflix.com/watch/${id}` : null;

    case "prime":
      // Global title identifier, e.g. amzn1.dv.gti.<uuid>.
      return `https://www.primevideo.com/detail/${encodeURIComponent(id)}`;

    case "max":
      // Matches the `uri` Max's own API returns for a play action.
      return `https://play.hbomax.com/video/watch/${encodeURIComponent(id)}`;

    case "apple": {
      // tv.apple.com resolves umc.cmc ids without the slug and redirects.
      const segment = mediaType === "movie" ? "movie" : "episode";
      return `https://tv.apple.com/${segment}/${encodeURIComponent(id)}`;
    }

    case "disney":
      // /play/<uuid> resolves for episodes and films alike.
      return `https://www.disneyplus.com/play/${encodeURIComponent(id)}`;

    case "jellyfin": {
      const server = extras?.jellyfinServerUrl?.trim().replace(/\/+$/, "");
      return server ? `${server}/web/#/details?id=${encodeURIComponent(id)}` : null;
    }

    default:
      return null;
  }
}

/** LG webOS app ids used by `webostv.command` / `system.launcher/launch`. */
const WEBOS_APP_ID: Record<string, string> = {
  netflix: "netflix",
  prime: "amazon",
  max: "com.hbo.hbomax",
  apple: "com.apple.atve.webos.appletv",
  disney: "com.disney.disneyplus-prod",
  jellyfin: "org.jellyfin.webos",
};

export interface WebosLaunch {
  appId: string;
  /** Payload for `system.launcher/launch` `contentId`. */
  contentId: string;
}

/**
 * Dynamic webOS content target for the given provider item.
 * Netflix needs the `m=` watch URL; Jellyfin uses the item id. Others get the web URL.
 */
export function webosLaunch(
  provider: string,
  providerContentId: string,
  mediaType: string,
  extras?: { jellyfinServerUrl?: string }
): WebosLaunch | null {
  const appId = WEBOS_APP_ID[provider];
  if (!appId) return null;
  const id = providerContentId?.trim();
  if (!id) return null;

  if (provider === "netflix") {
    const url = providerUrl(provider, id, mediaType);
    return url ? { appId, contentId: `m=${url}` } : null;
  }
  if (provider === "jellyfin") {
    return { appId, contentId: `id=${id}` };
  }
  const url = providerUrl(provider, id, mediaType, extras);
  return url ? { appId, contentId: url } : null;
}

/** Android TV packages used by the system launcher / Android TV Remote. */
const ANDROID_PACKAGE: Record<string, string> = {
  netflix: "com.netflix.ninja",
  prime: "com.amazon.amazonvideo.livingroom",
  max: "com.wbd.stream",
  apple: "com.apple.atve.androidtv.appletv",
  disney: "com.disney.disneyplus",
  jellyfin: "org.jellyfin.androidtv",
};

export interface AndroidLaunch {
  /** URI for `remote.turn_on` activity / `ACTION_VIEW`. */
  deeplink: string;
}

/**
 * Content URI (or app id) the Android TV launcher can open.
 * Jellyfin Android TV has no content deep link — package only.
 */
export function androidLaunch(
  provider: string,
  providerContentId: string,
  mediaType: string,
  extras?: { jellyfinServerUrl?: string }
): AndroidLaunch | null {
  const pkg = ANDROID_PACKAGE[provider];
  if (!pkg) return null;
  const id = providerContentId?.trim();
  if (!id) return null;

  if (provider === "prime") {
    return { deeplink: `https://app.primevideo.com/detail?gti=${encodeURIComponent(id)}` };
  }
  if (provider === "jellyfin") {
    return { deeplink: pkg };
  }
  const url = providerUrl(provider, id, mediaType, extras);
  return url ? { deeplink: url } : null;
}
