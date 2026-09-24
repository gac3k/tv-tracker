# vod-tracker

Self-hosted watch history for the streaming services you already pay for. vod-tracker signs in on your behalf, keeps what you have started, and puts Continue Watching, Watch Next, and upcoming premieres on one dashboard.

Your library stays on your machine. Streaming accounts are used only to read watch progress.

## Getting started

Install [Docker](https://docs.docker.com/get-docker/) with Compose, then from this directory:

```bash
docker compose up -d --build
```

Open the dashboard at [http://127.0.0.1:3001](http://127.0.0.1:3001) and create an account.

The first start builds two images: the tracker (API, sync, database) and the dashboard. Redis, used for scheduled sync, starts with them. Later starts reuse those images:

```bash
docker compose up -d
```

Stop everything with `docker compose down`. That keeps your library. `docker compose down -v` deletes it.

## Connect a service

On the dashboard, open **Providers**, choose a service, and use **Sign in**. A browser on the server is streamed to the page. Sign in the way you normally would (password, MFA, profile picker), then confirm. Use **Sync** on the provider card to pull history immediately. After that, sync runs on its own.

| Service | How you connect |
| --- | --- |
| Netflix, Prime Video, Max, Apple TV, Disney+ | Sign in through the streamed browser |
| Jellyfin | Server URL and an API key, under **Configure** |

Netflix, Prime Video, and Jellyfin can read account watch history. Max, Apple TV, and Disney+ only expose Continue Watching, so the dashboard follows that shelf.

## Configuration

Day-to-day settings live in the dashboard under **Settings**. The same values can be set as environment variables on the `vod-tracker` service in `docker-compose.yml`. An environment variable wins over the settings file.

### Posters and upcoming premieres

Artwork, episode runtimes, and the Upcoming row come from [TMDB](https://www.themoviedb.org/settings/api). Create a free API key, then either paste it into **Settings** or set it on the container:

```yaml
services:
  vod-tracker:
    environment:
      TMDB_API_KEY: your-key-here
      TMDB_LANGUAGE: en-US
```

`TMDB_LANGUAGE` should match the title language your services show (`pl-PL`, `en-US`, …). Titles still track without a key; posters and upcoming premieres stay empty.

In the settings file this is `tmdb.api_key`.

### How often to sync

`SYNC_INTERVAL_MINUTES` defaults to `60`. Set it to `0` to sync only when you press **Sync**.

### Who can open the dashboard

The published ports listen on localhost only:

- dashboard: `127.0.0.1:3001`
- API: `127.0.0.1:3000`

To open the dashboard from another computer on your network, publish the dashboard port (`3001:3001`) and tell the server which origin your browser uses:

```yaml
services:
  vod-tracker:
    environment:
      AUTH_BASE_URL: http://tv.lan:3001
      AUTH_TRUSTED_ORIGINS: http://tv.lan:3001
      BETTER_AUTH_SECRET: replace-with-a-long-random-string
```

`BETTER_AUTH_SECRET` signs login sessions. Set your own before the dashboard is reachable beyond that machine. Generate one with `openssl rand -base64 32`.

The API has no separate login of its own; keep port 3000 on localhost, or put both services behind a reverse proxy you control.

### Where data is stored

Compose keeps two volumes:

- `vod-data` — the library (SQLite) and the browser profiles that stay signed in to each service. Back this volume up. Treat it like a password store.
- `vod-redis` — the sync queue. Safe to recreate.

### Optional

- **Home Assistant.** In Settings, set `homeassistant.mqtt_url` (or `MQTT_URL`) to publish a device with a Last Watched sensor.
- **TV apps.** `tv.os` is `webos` or `android`, used when opening a title on a TV. Override with `TV_OS`.
- **Firefox.** The extension can copy a login you already have in Firefox instead of using the streamed browser. Build it from `apps/extension` and paste the token shown on the Settings page.

## Update

```bash
git pull
docker compose up -d --build
```

## Run from source

For local development: Node.js 20.12 or newer, pnpm, and Redis.

```bash
pnpm install
pnpm exec playwright install chromium
docker compose up -d redis
pnpm dev
```

The API listens on port 3000 and the dashboard on port 3001. Environment variables are listed in `apps/server/.env.example`. Checks: `pnpm test` and `pnpm typecheck`.

Provider login from the CLI, on a machine with a display: `pnpm cli login netflix` (same subcommand for `prime`, `max`, `apple`, `disney`).

Some provider adapters derive request shapes from [Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler) (MIT). See `NOTICE`.
