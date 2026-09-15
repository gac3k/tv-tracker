# Product

## Platform

web

## Users

Primary user is the operator of this self-hosted tracker — today a single person on localhost, later possibly other people in the same household on the same instance. They already know which VODs they subscribe to. They come here to see what they are in the middle of, and to resume it, not to discover new titles.

## Product Purpose

vod-tracker keeps a local, provider-independent record of what was watched on Netflix, Prime Video, Max, Apple TV, and Disney+. Success is: open the dashboard, recognize the next title to continue, and jump back into the right player. A secondary job is inspecting the raw episode-level watch log when the grouped shelf is not enough.

## Positioning

The user's own SQLite database is the source of truth. Provider UIs, Trakt, and TMDB are inputs or later outputs — they do not own the history. The dashboard is a private Continue Watching shelf across every subscribed VOD, not a clone of any one service.

## Operating Context

Local Next.js dashboard on port 3001 talking to a NestJS API on 127.0.0.1:3000. Sync happens through a persistent, manually-authenticated Chromium session per provider. Artwork and episode runtimes come from TMDB when a key is set; titles still work without it. There is no account system on the API.

## Capabilities and Constraints

- Observations are immutable points-in-time; the library view aggregates them.
- Default shelf: one card per title (show or movie), sorted by last watch, with badges for every VOD that title was seen on. Six episodes of one show must appear as one card.
- History section: the existing episode-level list (one card per episode / movie play).
- Same title on two VODs is one card, not two.
- Deep links open the provider player when we can build one.
- Provider APIs are private and can break; raw payloads are kept.
- The HTTP API has no authentication; it binds to localhost by default.
- Title merge across providers is by normalized title string, not a canonical ID. Spelling mismatches will not merge until a later identity layer.

## Brand Commitments

Product name in the UI today: `vod·tracker`. Layout may be lightly Netflix-like (poster shelf, progress on the artwork, sidebar + top bar) but must not copy Netflix branding, wordmark, or red. Existing dark paper + coral accent in `apps/web/app/globals.css` is the incumbent surface.

## Evidence on Hand

Real data only: synced watch observations, derived sessions, TMDB artwork when configured, live provider auth/sync status. Do not invent subscriber counts, watch-time stats, testimonials, or catalog size.

## Product Principles

- Resume first: the default view answers “what do I continue?”
- One title, one card: episode noise stays in History.
- Honest about uncertainty: missing artwork, derived progress, and failed syncs stay visible.
- Local and private: never look like a public streaming storefront.
- Provider identity is a badge, not the page.

## Accessibility & Inclusion

No product-specific standard was set. Keyboard focus, visible focus rings, and `prefers-reduced-motion` already exist on the incumbent UI and must be kept.
