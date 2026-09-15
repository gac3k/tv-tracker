# Universal Trakt Scrobbler — Netflix implementation analysis

Analyzed at UTS commit `7ad00a272b2e890eaa4a176542f8858b26ea88d4` (2026-08-28).
Relevant files: `src/services/netflix/NetflixApi.ts`, `NetflixProgress.ts`,
`NetflixParser.ts`, `NetflixService.ts`. UTS is MIT licensed (c) 2020 trakt-tools.

## Session / authentication

UTS never logs in itself. It assumes the user's browser is already
authenticated and extracts session data in one of two ways:

1. **Injected script** (preferred): reads the global `window.netflix` object:
   - `netflix.reactContext.models.userInfo.data.authURL` — CSRF-ish token used by some endpoints
   - `netflix.reactContext.models.userInfo.data.name` — active profile name (null = no profile selected)
   - `netflix.reactContext.models.userInfo.data.userGuid` — active profile GUID (needed for history)
   - `netflix.reactContext.models.serverDefs.data.BUILD_IDENTIFIER` — used to build fallback API URLs
2. **HTML scrape fallback**: GET `https://www.netflix.com/settings/viewed/` and
   regex the same fields out of the inlined JS (values are JS-escaped, e.g. `\x3D`).

"Logged in" check = `profileName != null`.

## Viewing history endpoint

POST (with browser cookies):

```
https://www.netflix.com/api/aui/pathEvaluator/web/%5E2.0.0
  ?method=call
  &callPath=%5B%22aui%22%2C%22viewingActivity%22%2C<page>%2C<pageSize>%5D
  &falcor_server=0.1.0
```

- `callPath` is the URL-encoded falcor path `["aui","viewingActivity",<page>,<pageSize>]`
- body: `param=<urlencoded JSON {"guid":"<userGuid>"}>`
- required header:
  `x-netflix.request.routing: {"path":"/nq/aui/endpoint/%5E1.0.0-web/pathEvaluator","control_tag":"auinqweb"}`
- response shape: `jsonGraph.aui.viewingActivity.value.viewedItems[]`
- empty `viewedItems` array = end of history; UTS pages with pageSize 50.

### History item fields

Episode: `{ date, episodeTitle, movieID, series, seriesTitle, title, bookmark?, duration? }`
Movie:   `{ date, movieID, title, bookmark?, duration? }`

- `date` — epoch **milliseconds** of the watch day
- `movieID` — Netflix video id of the episode/movie (the provider content id)
- `series` — Netflix id of the show (episodes only)
- `bookmark` / `duration` — playback position and runtime in **seconds** (both optional)

## Progress calculation (`NetflixProgress.ts`)

`progress = clamp((bookmark / duration) * 100, 0, 100)`, floored to 2 decimal
places; `-1` sentinel when either value is missing/invalid. When per-episode
metadata is available, `metadata.bookmark.offset` / `metadata.runtime`
override the history values (`mergeNetflixHistoryProgress`).

## Metadata endpoint

The old bulk `pathEvaluator` metadata route is dead (returns 502/412/421/404).
UTS now fetches one metadata document per unique show/movie:

```
GET <base>/metadata?languages=en-US&movieid=<showOrMovieId>
```

Base URLs tried in order (first working one is cached):
1. `https://www.netflix.com/nq/website/memberapi/release`  ← currently working
2. `https://www.netflix.com/nq/website/memberapi/<BUILD_IDENTIFIER>`
3. `https://www.netflix.com/api/shakti/<BUILD_IDENTIFIER>`
4. `https://www.netflix.com/api/shakti/mre`
Each also retried with `&authURL=<authUrl>` appended.

Response: `{ video: { type: "show"|"movie", id, title, year, seasons?: [{ seq, episodes: [{ id, seq, title, bookmark?, runtime? }] }], hiddenEpisodeNumbers? } }`

Season/episode numbers come from matching `historyItem.movieID` against
`seasons[].episodes[].id` and taking `season.seq` / `episode.seq`.
`hiddenEpisodeNumbers: true` marks "collections" whose numbering does not match
canonical numbering — UTS zeroes S/E in that case. Metadata failures are
non-fatal: history is still usable (title only, no year/S/E).

## Live playback (scrobbling)

Read from the page global:
`netflix.appContext.state.playerApp.getState().videoPlayer.playbackStateBySessionId`
→ `{ currentTime, duration, paused, playing, videoId }`. Only works on an open
`/watch/` tab. Not used in our MVP (we poll history instead); could power a
future real `/now-playing`.

## What we reuse (MIT, attribution in NOTICE + file headers)

- history endpoint URL, callPath/body/header format, response path
- history item / metadata response TypeScript shapes
- progress formula and merge logic
- metadata base-URL fallback list and per-show matching logic

## What we do NOT reuse (extension-specific)

- `ScriptInjector` / content-script messaging — replaced by Playwright `page.evaluate`
- `Requests` (extension background fetch) — replaced by in-page `fetch` with `credentials: "include"`
- `ScrobbleParser` DOM/tick machinery, Trakt item models, UI/store/locales
- HTML-scrape session fallback — Playwright reads `window.netflix` directly

---

# Additional providers (Prime Video, Max, Apple TV)

Analyzed at the same UTS commit. Summary of what each contributes and the
headless adaptation.

## Prime Video — `src/services/amazon-prime/AmazonPrimeApi.ts`

- **Auth**: cookie-based; no tokens. `GetAppStartupConfig` returns `homeRegion`
  and `defaultVideoWebsite`, from which the region-specific `atv-ps[-region].`
  API host and website API path (`/gp/video/api` vs `/region/<r>/api`) are built.
- **Profile**: `getProfiles` -> the `isSelected` profile.
- **History**: `getWatchHistorySettingsPage` widget `watch-history`; episodes are
  nested under show entries (flatten leaves); token pagination via `nextToken`.
- **Progress**: `enrichItemMetadata` batched by title id -> `progress.percentage`
  (defaults to 100 when absent).
- **Metadata**: `GetPlaybackResources?...desiredResources=CatalogMetadata` per
  `gti`; `entityType` distinguishes TV Show / Movie; `family.tvAncestors` carries
  season number and show title. Version tags `[a/b]` stripped from titles.
- **Reused**: all of the above. **Not reused**: `nextItemId` prefetch (scrobbler
  autoplay support), `ScriptInjector`, `Requests`. Headless twist: requests run
  through Playwright's `APIRequestContext` (uses profile cookies, bypasses CORS
  on the cross-origin atv-ps host).

## Max — `src/services/hbo-max/HboMaxApi.ts`

- **Auth**: tokens live in the web player's `localStorage` (`authToken`,
  `deviceSerialNumber`). Three-step exchange: global client-credentials token ->
  `clientConfig` (per-user `userSubdomain`) -> `refresh_token` grant. Client
  identifiers (`CLIENT_VERSION/ID`, `CONTRACT`) captured from app.js.
- **Profile**: POST `content` `[{id:"urn:hbo:profiles:mine"}]` -> `isMe` profile.
- **History**: GET `markers` (full list, no paging); keep `urn:hbo:episode|feature`;
  `progress = position/runtime`.
- **Metadata**: POST `content` `[{id}]` batched; `seriesTitles`/`seasonNumber`/
  `numberInSeason` for episodes, `titles.full` for movies.
- **Reused**: all of the above. **Not reused**: extension `Cache`, `ScriptInjector`.
  Headless twist: read `localStorage` via `page.evaluate`, then all API calls via
  `APIRequestContext` with the `x-hbo-client-version` + bearer headers.

## Apple TV — `src/services/apple-tv/AppleTvParser.ts`

- **No account history API** (UTS marks `hasSync:false`). UTS only has a DOM
  *scrobbler* reading the current player + JSON-LD.
- **Headless adaptation**: there is no history endpoint to call, so our provider
  scrapes the **"Up Next" shelf** from the tv.apple.com DOM (anchors matching
  `/(movie|episode|show)/…/umc.cmc.…` that carry a progress indicator) and emits
  `continue_watching` observations. In-progress items only, no watch timestamps.
- **Reused**: URL/route id shapes and the `SxEy` label parsing. **Not reused**:
  the scrobble/tick lifecycle, player-overlay fingerprinting, Trakt item models.
- This is the most fragile adapter (DOM-dependent) and cannot see fully-watched
  history the way the JSON-API providers can.
