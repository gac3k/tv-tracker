# vod-tracker

Local, self-hosted service that tracks your streaming/VOD watch history
independently of the playback device. It periodically reads account-side
viewing history from streaming providers (Netflix first) through a persistent,
manually-authenticated Chromium session, normalizes it into its own schema,
stores it in SQLite and exposes a small REST API (NestJS on Fastify) plus a
Next.js dashboard to browse the data.

Your own database is the source of truth. Trakt, TMDB, Home Assistant etc. are
planned as later outputs, never as the core data model.

> **Warning:** provider APIs used here are private and undocumented. They can
> change or break at any time. Raw provider payloads are always stored with
> each observation so history can be re-parsed after an API change.

## Architecture

```text
Persistent Chromium / Playwright profile   (.data/browser/<provider>/)
                |
                v
        Provider adapter                   (src/providers/netflix/)
                |  in-page fetch with browser cookies
                v
       Normalized observations             (provider_observations, raw payload kept)
                |
                v
          Session engine                   (derived playback_sessions, heuristic)
                |
          +-----+-----+
          |           |
          v           v
       SQLite      REST API (NestJS + Fastify, 127.0.0.1:3000)
                          |
                          v
                   Web dashboard (Next.js, 127.0.0.1:3001)
```

Monorepo layout (pnpm workspaces):

```text
apps/server   NestJS API + CLI + provider adapters (@vod/server)
apps/web      Next.js dashboard (@vod/web) — proxies /api/* to the API server
```

- **Observations** are immutable data points ("content X was at 53% at time T").
  Deduplicated by a deterministic fingerprint, so polling never creates
  duplicates, but every progress change is kept.
- **Sessions** are derived from observations by a simple heuristic (same
  content, close in time, increasing progress). They are rebuilt on every sync
  and are *not* the provider's authoritative history.

Netflix API access (endpoints, request format, progress math) is adapted from
[Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler)
(MIT, (c) 2020 trakt-tools) — see `NOTICE` and `docs/uts-netflix-analysis.md`.

## Security

- The browser profile directory **is a credential** (it contains your Netflix
  cookies). It lives in `apps/server/.data/browser/` which is gitignored. Do not copy it
  anywhere, do not expose it over HTTP.
- No usernames/passwords are ever asked for or stored; you log in manually in
  a real browser window (MFA/CAPTCHA work normally).
- Cookies, tokens and authorization headers are never logged.
- The HTTP server binds to `127.0.0.1` by default. Listening on `0.0.0.0`
  requires explicitly setting `HOST=0.0.0.0` (do this only on a trusted
  network — there is no authentication on the API).
- TMDB lookups send only titles (and season/episode numbers) to themoviedb.org —
  never account identifiers, cookies, or provider ids.
- Debug fixtures (`--save-fixture`) are sanitized: keys matching
  auth/token/cookie/guid/email/session/etc. are redacted before writing.

## Installation

Requires Node.js >= 20.12, pnpm, and Redis (BullMQ). Redis on localhost:6379
is the default; override with `REDIS_URL`.

```bash
pnpm install
pnpm exec playwright install chromium
docker compose up -d redis   # or any Redis 7 at REDIS_URL
```

On NixOS (or other non-FHS distros) the Playwright-downloaded Chromium may not
start; the service then automatically falls back to a system-installed
`chromium`/`google-chrome`, or you can pin one explicitly:

```bash
export BROWSER_EXECUTABLE_PATH=/run/current-system/sw/bin/chromium
```

## Netflix login

```bash
pnpm cli login netflix
```

A visible Chromium window opens using the persistent profile in
`apps/server/.data/browser/netflix/`. Log in manually (password, MFA, CAPTCHA) and
**select your Netflix profile**. The CLI polls the page and tells you when the
session looks authenticated; press Enter in the terminal to close the browser
and save the session.

Check it worked:

```bash
pnpm cli status netflix
# netflix:
#   authenticated: yes
#   profile: <your profile name>
```

Other providers work the same way — `login` / `status` / `sync` take a provider
name:

```bash
pnpm cli login prime     # Amazon Prime Video
pnpm cli login max       # HBO Max / Max
pnpm cli login apple     # Apple TV
```


## Syncing

```bash
# fetch and print without persisting anything
pnpm cli sync netflix --dry-run

# fetch and persist observations + rebuild derived sessions
pnpm cli sync netflix

# options
pnpm cli sync netflix --pages 5          # more history pages (50 items each)
pnpm cli sync netflix --save-fixture     # save sanitized raw responses to .data/fixtures/netflix/
pnpm cli sync netflix --dry-run --debug  # dump normalized JSON as well
```

## Running

```bash
pnpm dev          # API server (3000) + web dashboard (3001) in parallel
pnpm dev:server   # API server only
pnpm dev:web      # dashboard only
# production:
pnpm build && pnpm start   # starts the API server; run the web app with pnpm --filter @vod/web start
```

Dashboard: http://127.0.0.1:3001 — Netflix status, sync button, derived
playback sessions and raw observations.

The server also enqueues a BullMQ sync job every `SYNC_INTERVAL_MINUTES`
(default 60, `0` disables the scheduler). Manual **Sync now** and CLI sync go
through the same pipeline and show up under **System → Jobs**. Redis is
required (`REDIS_URL`, default `redis://127.0.0.1:6379`).

## Deployment (Docker / headless)

`Dockerfile` is the Playwright-based **sync engine + REST API**. `Dockerfile.web`
is the Next.js dashboard. `docker-compose.yml` runs both (plus Redis).

```bash
docker compose up -d --build
# API on 127.0.0.1:3000, dashboard on 127.0.0.1:3001
```

Pushes to `main` cut a GitHub Release and publish two images to GitHub Packages:
`ghcr.io/<owner>/<repo>/server:<version>` and `.../web:<version>` (and `:latest`).
The first release is `0.1.0`; later versions come from
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor,
`fix:` → patch).

The `vod-data` volume holds both the SQLite database and the browser profiles
(`/data/browser/<provider>`). **Treat that volume as a credential store** — it
contains your streaming cookies. Back it up privately; never bake it into an image
(`.dockerignore` excludes `.data`).

### Initial login on a headless / remote server

Provider login is interactive: it opens a **visible** browser so you can type
your password, pass MFA/CAPTCHA and pick a profile. A Docker container or a
remote homelab box normally has no screen, so do the one-time login one of two
ways:

**Option 1 — log in on your desktop, copy the profile (simplest).**
On a machine with a display:

```bash
pnpm cli login netflix        # (repeat per provider)
```

Then copy the resulting profile directory to the server's data volume:

```bash
# host path of the volume is e.g. /var/lib/docker/volumes/<project>_vod-data/_data
scp -r apps/server/.data/browser/netflix     user@server:/path/to/vod-data/browser/
```

The profile is a self-contained Chromium user-data dir; sync reuses it as-is.
Re-copy when a login eventually expires.

**Option 2 — the built-in browser console (recommended, no VNC needed).**
Open `http://<server>:3001/login/<provider>` in your own browser and click
**Open login window**. A real Chromium starts on the server; its picture is
streamed to the page and your mouse/keyboard are replayed into it. You log in,
pass MFA/CAPTCHA and pick a profile exactly as you would locally, then click
**I'm signed in** — the session lands in the persistent profile that sync uses.

This works because the headless problem was never that the browser can't render
the login page; it's that *you* can't see it. The console makes your browser the
display. No X server, no VNC daemon, no extra packages — it reuses the Playwright
that is already there (Chrome DevTools Protocol screencast for frames, CDP input
events for the replay).

Constraints worth knowing:

- One session at a time, and it auto-closes after 15 minutes.
- The stream WebSocket needs a single-use token minted by
  `POST /providers/:provider/login/start`; the UI handles this for you.
- Bandwidth is roughly 0.3–1 MB/s while the page animates — fine on a LAN,
  noticeable over a slow WAN link.
- **You are typing credentials into a page whose picture crosses the network.**
  vod-tracker never stores or logs frames, keystrokes or credentials, but only
  use this over a trusted network (or an SSH tunnel / VPN), and keep `HOST` at
  `127.0.0.1` unless you have put authentication in front of the service.

**Option 3 — Xvfb + noVNC.** Still available if you prefer a full desktop:
run a virtual X server and a VNC bridge, set `DISPLAY`, and use
`pnpm cli login <provider>`. `cli login` detects a missing `$DISPLAY` and prints
this guidance. Heavier than Option 2 and needs extra packages.

Apple TV and Disney+ read the DOM, so their login only needs you to be signed in
on the site; Netflix, Prime and Max read account APIs with the session cookies.

## API

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/providers
curl http://127.0.0.1:3000/providers/netflix/status
curl -X POST http://127.0.0.1:3000/providers/netflix/sync
curl "http://127.0.0.1:3000/history?provider=netflix&limit=50"
curl "http://127.0.0.1:3000/observations?provider=netflix&limit=50&since=2026-09-01"
curl "http://127.0.0.1:3000/library?provider=netflix,prime&status=in_progress&sort=progress"
curl -X POST http://127.0.0.1:3000/providers/netflix/login/start   # streamed login
curl http://127.0.0.1:3000/providers/netflix/login/status
curl -X POST http://127.0.0.1:3000/providers/netflix/login/finish
curl http://127.0.0.1:3000/now-playing
curl http://127.0.0.1:3000/jobs
curl http://127.0.0.1:3000/jobs/1
curl -X POST http://127.0.0.1:3000/jobs
```

- `/history` — derived playback sessions (newest first).
- `/observations` — raw normalized observations (without the `raw` payload;
  that stays in the DB).
- `/library` — one card per title for the poster grid: aggregated progress,
  artwork, a `url` deep link into the provider's player, and facet counts. Filters: `provider` (comma-separated), `type`
  (`movie`/`episode`), `status` (`all`/`in_progress`/`completed`/`unwatched`),
  `q` (search), `sort` (`recent`/`progress`/`title`), `limit`.
- `/providers/:provider/login/start|status|finish` — the streamed browser console
  (see *Initial login on a headless / remote server*). `start` returns a
  single-use token for the `/remote-login/stream` WebSocket; treat it as a
  credential.
- `/now-playing` — heuristic guess whether something is being watched right
  now, based on recent progress increases. **Not** real-time playback state:
  Netflix's history endpoint lags actual playback, so treat `confidence`
  accordingly.
- `/jobs` — recent sync jobs (status, duration, per-provider summary).
  `GET /jobs/:id` is the debug log for one run. `POST /jobs` enqueues a sync
  of every enabled provider (`{ "provider": "netflix" }` for one).

## Database

SQLite at `apps/server/.data/vod-tracker.sqlite` (WAL mode). Schema is managed by Drizzle
migrations in `drizzle/`, applied automatically on startup. Tables:

- `provider_observations` — normalized observations + original `raw` JSON +
  `parser_version`
- `playback_sessions` — derived sessions (rebuilt each sync)
- `sync_state` — per-provider last sync status/error
- `job_runs` / `job_logs` — durable debug log for each sync job (BullMQ is the
  scheduler; Redis job history is ephemeral)

Switching to PostgreSQL later means swapping the Drizzle driver/dialect and
regenerating migrations; queries go through Drizzle everywhere.

## Artwork (TMDB)

The dashboard shows a Netflix-style poster grid. Artwork and canonical runtimes
come from [TMDB](https://www.themoviedb.org/settings/api) — a free API key:

```bash
echo 'TMDB_API_KEY=your-key-here' >> apps/server/.env
```

Set `TMDB_LANGUAGE` to the language your providers display titles in
(e.g. `pl-PL`) — matching is exact-title-first, so a mismatched language makes
"Inside Out" resolve to "Inside Out 2".

Without a key the grid still works: tiles fall back to generated title cards.
With a key you also get **derived progress** for Apple TV, Disney+ and Max —
those providers only report "42 min left", so the runtime from TMDB is what
turns it into a percentage. Derived bars are hatched to distinguish them from
provider-reported ones. Lookups are cached in the `artwork` table (negative
results too), so a title is only ever resolved once. To force a re-resolve after
changing the language or fixing a parser:

```bash
sqlite3 apps/server/.data/vod-tracker.sqlite 'delete from artwork;'
```

Every card links straight into the provider (`netflix.com/watch/<id>`,
`primevideo.com/detail/<gti>`, `play.hbomax.com/video/watch/<uuid>`,
`tv.apple.com/episode/<umc.cmc.id>`, `disneyplus.com/play/<uuid>`) — built from
the ids we already store, so no extra scraping is needed.

Derived progress is deliberately conservative: when the reported remaining time
exceeds the matched runtime (a wrong episode match, or a shelf entry covering a
multi-episode block), no percentage is shown at all rather than a misleading 0 %.

## Configuration

See `apps/server/.env.example`. A `.env` file in `apps/server/` is loaded
automatically. The web app reads `API_URL` (default `http://127.0.0.1:3000`).

## Troubleshooting

**`ProviderAuthenticationError` / `authenticated: no`** — the persisted
session expired or no profile was selected. Run `pnpm cli login netflix`
again, make sure you end up on the profile you want (the page must show
content, not the "Who's watching?" screen), then re-run sync.

**`Browser profile ... is in use`** — an interactive login window (or another
sync/server process) holds the Chromium profile lock. Close it and retry.

**`Provider API may have changed`** — Netflix moved or changed a private
endpoint. Run `pnpm cli sync netflix --save-fixture` and inspect the sanitized
response in `apps/server/.data/fixtures/netflix/`; the parser lives in
`apps/server/src/providers/netflix/`. Existing observations keep their raw payloads, so
nothing is lost.

**Playwright Chromium fails to start (missing shared libraries)** — non-FHS
distro; see the `BROWSER_EXECUTABLE_PATH` note under Installation.

## Development

```bash
pnpm test        # vitest unit tests (parser, dedup, session inference)
pnpm typecheck
pnpm lint
```

## Attribution

Netflix endpoint knowledge, request formats and progress calculation are
derived from Universal Trakt Scrobbler (MIT License, Copyright (c) 2020
trakt-tools). Full attribution and the list of derived files: `NOTICE`;
technical analysis: `docs/uts-netflix-analysis.md`.

## Providers

| Provider   | Auth model                              | History source                        | Notes |
|------------|-----------------------------------------|---------------------------------------|-------|
| Netflix    | browser cookies (`window.netflix`)      | `pathEvaluator` viewing activity      | full history + season/episode metadata |
| Prime Video| browser cookies                         | `getWatchHistorySettingsPage`         | progress via `enrichItemMetadata` |
| Max        | cookies (modern WBD web API)            | "Continue Watching" rail (response intercepted) | continue-watching only; no % in payload |
| Apple TV   | browser session (no profile name)       | "Continue Watching" shelf scraped from the DOM | continue-watching only; time-remaining, no % (Apple exposes no history API) |
| Disney+    | browser session (no profile name)       | "Continue Watching" set scraped from the DOM | continue-watching only; **not verified against a live account** |

Apple TV is DOM-scraped and therefore the most fragile; it captures in-progress
items only (the "Continue Watching" shelf), with time-remaining rather than a
played-percentage, and no watch timestamps.

## Roadmap

- TMDB resolver (provider item -> canonical movie/episode id)
- Trakt output (our sessions -> Trakt scrobble/history, as a sink only)
- Home Assistant sensors (REST/MQTT)
