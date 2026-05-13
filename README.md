# TripleS

TripleS is a personal web platform for synchronizing music playlists between Spotify, YouTube and SoundCloud. The first stage is intentionally local-first: SQLite, simple admin login, route handlers and realistic mock adapters that work without external API keys.

## Quick Start

```bash
npm install
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
```

Open `http://127.0.0.1:3000`, sign in with:

```txt
admin@example.com / changeme
```

Run checks:

```bash
npm run lint
npm run test
npm run build
```

## Hosted Deployment

For a hosted setup where the app runs from a domain and normal sync does not depend on this computer, use:

- Vercel for the Next.js web app and domain.
- Neon for Postgres.
- GitHub Actions for the scheduled Playwright sync worker.
- GitHub Secrets for browser session state.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full setup.

## Project Structure

```txt
app/                  Next.js App Router pages and API route handlers
components/           Sidebar, mobile nav, cards, tables and sync controls
lib/auth/             JWT cookie session and password helpers
lib/crypto/           AES-256-GCM token encryption
lib/db/               Prisma singleton
lib/services/         Spotify, YouTube, SoundCloud adapters and mock adapters
lib/sync/             Sync engine, match engine and shared sync types
lib/utils/            Track normalization, similarity, class utilities
prisma/               SQLite schema, migration and seed data
scripts/              SQLite bootstrap and sync worker
```

## Environment

Copy `.env.example` to `.env` when you want to override defaults. All external API variables are optional. If Spotify, Google or SoundCloud credentials are empty, the app logs messages like `[spotify] Running in MOCK mode` and uses realistic mock playlists/tracks.

Required only for production-hardening:

```env
JWT_SECRET="replace-me"
ENCRYPTION_KEY="32-byte-hex-key"
CRON_SECRET="optional-cron-secret"
```

## SQLite to PostgreSQL or Supabase

Local development uses SQLite:

```prisma
provider = "sqlite"
url      = "file:./dev.db"
```

For PostgreSQL/Supabase, change the datasource to:

```prisma
provider = "postgresql"
url      = env("DATABASE_URL")
```

Then set `DATABASE_URL` to the Supabase pooled or direct connection string and run a new migration. PostgreSQL also supports native Prisma enums, so the string enum-like fields can be converted back to Prisma `enum` blocks during that migration.

## Spotify API

Create a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```txt
http://127.0.0.1:3000/api/oauth/spotify/callback
```

Then set:

```env
SPOTIFY_CLIENT_ID="..."
SPOTIFY_CLIENT_SECRET="..."
SPOTIFY_REDIRECT_URI="http://127.0.0.1:3000/api/oauth/spotify/callback"
SPOTIFY_SCOPES="user-read-private user-read-email"
SPOTIFY_ENABLE_PLAYLIST_SCOPES="false"
SPOTIFY_ENABLE_WRITE_SCOPES="false"
```

The Spotify integration already includes the Authorization Code flow, encrypted token storage, refresh-token handling and real Web API calls for profile, playlists, playlist tracks, search, add and remove. The dashboard `Connect` button starts OAuth when credentials are present and falls back to mock mode when they are empty.

For local Spotify OAuth, use `127.0.0.1` instead of `localhost`. Spotify rejects `localhost` redirect URIs in the dashboard, while `http://127.0.0.1:3000/api/oauth/spotify/callback` is accepted for local development.

For the first login, keep `SPOTIFY_SCOPES="user-read-private user-read-email"`. This requests only profile scopes. After login works, remove `SPOTIFY_SCOPES` and set `SPOTIFY_ENABLE_PLAYLIST_SCOPES="true"` to read playlists. Set `SPOTIFY_ENABLE_WRITE_SCOPES="true"` later only if Spotify should be a sync destination that the app writes to.

If Spotify shows a generic `Oops! Something went wrong` page before returning to the app, check:

- Spotify Dashboard app has **Web API** enabled.
- Redirect URI is saved exactly as `http://127.0.0.1:3000/api/oauth/spotify/callback`.
- Your Spotify account email is added under **Users and Access** for development mode.
- The Client ID in `.env` is the app's Client ID, not the Client Secret.
- Debug config at `http://127.0.0.1:3000/api/oauth/spotify/debug` after logging in.

If Spotify returns `Active premium subscription required for the owner of the app`, the app saves the encrypted tokens but marks the account as `LIMITED`. In this mode the dashboard shows `limited`, playlist refresh skips Spotify, and the rest of the app remains usable with mock YouTube/SoundCloud data.

Official Spotify docs used by this implementation:

- Authorization Code Flow: https://developer.spotify.com/documentation/web-api/tutorials/code-flow
- Current user profile: https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile
- Current user's playlists: https://developer.spotify.com/documentation/web-api/reference/get-list-users-playlists
- Search: https://developer.spotify.com/documentation/web-api/reference/search

## YouTube Music Browser Automation

TripleS does not use the YouTube Data API. The real YouTube path is browser automation: a dedicated Chrome profile is logged into your account once, then the worker controls YouTube Music like a user would.

Local setup:

```bash
npm run chrome
npm run login -- youtube cdp
npm run yt -- list
```

`npm run chrome` starts a normal Chrome process with a dedicated service profile such as `worker/chrome-profile/youtube` and a CDP port. Log in normally in that Chrome window, keep it open, then run the `login` command to verify the session and export `worker/state/youtube.json`. The saved state and profile are ignored by git.

Runner commands:

```bash
npm run yt -- list
npm run yt -- tracks "PL..."
npm run yt -- search "Artist - Track"
npm run yt -- add "Playlist name or PL..." "Artist - Track"
npm run yt -- remove "PL..." "Track title or video id"
```

To let the app's sync engine use the YouTube Music browser runner instead of mock data, set:

```env
YOUTUBE_BROWSER_AUTOMATION="true"
```

For remote scheduled runs, store the exported `worker/state/youtube.json` as a secret and restore it before starting the worker. GitHub Actions cron is the most practical free target; Vercel-style serverless functions are a poor fit for long-lived browser automation.

## SoundCloud API

Set `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET` and `SOUNDCLOUD_REDIRECT_URI`, then implement `lib/services/soundcloud/SoundCloudAdapter.ts`. SoundCloud API access may be limited depending on app approval and account status, so keep mock mode available for local development.

## SoundCloud Browser Automation

SoundCloud can also run without API credentials through the browser worker. Log in once and save the session:

```bash
npm run chrome -- soundcloud
npm run login -- soundcloud cdp
npm run sc -- list
```

Runner commands:

```bash
npm run sc -- list
npm run sc -- tracks "user/sets/playlist-slug"
npm run sc -- search "Artist - Track"
npm run sc -- add "user/sets/playlist-slug" "artist/track-slug-or-url"
npm run sc -- remove "user/sets/playlist-slug" "artist/track-slug-or-url"
npm run sc -- create "Playlist name"
```

To let playlist refresh and sync use the browser-backed SoundCloud reader, set:

```env
SOUNDCLOUD_BROWSER_AUTOMATION="true"
```

The SoundCloud browser path supports playlist listing, playlist track reading, search, playlist creation and add/remove commands through the saved browser session. Read operations are verified locally. Write operations currently use SoundCloud's internal web API from the logged-in session and may be blocked by SoundCloud captcha/anti-abuse responses; when that happens the app reports the block and leaves the playlist unchanged.

The browser tools page is available at:

```txt
http://127.0.0.1:3000/soundcloud-browser
```

## Background Sync

Manual run from the UI calls:

```txt
POST /api/sync/run
```

External cron can call:

```txt
GET /api/cron/sync?secret=YOUR_CRON_SECRET
```

Local worker:

```bash
npm run sync-worker
```

Worker diagnostics:

```bash
npm run worker:check
```

This checks database reachability, browser mode, saved state/profile paths, YouTube Music playlist reads and SoundCloud playlist reads. It does not perform write actions, so it will not create playlists or modify accounts.

There is no `while(true)` loop inside Next.js route handlers.

## Playwright Worker Login

Use the real Chrome CDP path instead of a Playwright-owned login window:

```bash
npm run chrome -- youtube
npm run login -- youtube cdp
npm run yt -- list
```

For SoundCloud sign-in with Google, use the same real Chrome CDP path:

```bash
npm run chrome -- soundcloud
npm run login -- soundcloud cdp
npm run sc -- list
```

Generic playlist listing for all three browser-backed services:

```bash
npm run library -- youtube
npm run library -- spotify
npm run library -- soundcloud
```

By default runners use the saved state headlessly. Set `WORKER_BROWSER=cdp` to operate against the already running Chrome window, or `WORKER_BROWSER=profile` to reuse the full persistent Chrome profile for that service: `worker/chrome-profile/youtube` for YouTube Music and `worker/chrome-profile/soundcloud` for SoundCloud. Set `HEADLESS=false` to debug visually, and `YT_DEBUG=true` to save screenshots/HTML under `worker/state`.

This keeps Spotify and SoundCloud behavior unchanged. YouTube browser mode is best used locally or in a controlled worker process; it depends on a valid `worker/state/youtube.json`.

## Stage One Limits and Plans

The first stage uses mock data unless a browser runner or Spotify cookie is enabled. It does not store or download music, does not implement payments, PWA support or an admin panel. Next steps are stronger browser automation for all services, scheduled worker deployment, stronger deduplication and production hardening.

The sync engine is idempotent for the current mock flow: repeated runs reuse existing `TrackMatch`, pending `ManualMatchCandidate` and `PlaylistTrackState` records instead of creating duplicate rows. Sync logs are still written per run so history remains auditable.
