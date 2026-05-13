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

For hosted Postgres, `DATABASE_URL` is the runtime connection string. `DIRECT_URL` is optional but recommended for migrations when the provider offers a direct non-pooled URL. The build script uses `DIRECT_URL` for `prisma migrate deploy` when it is present and falls back to `DATABASE_URL` otherwise.

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

TripleS does not use the YouTube Data API. The real YouTube path is browser automation built on **[CloakBrowser](https://github.com/CloakHQ/CloakBrowser)** — a stealth Chromium binary with source-level fingerprint patches and human-like input. A dedicated profile is logged into your account once, then the worker controls YouTube Music like a user would.

Local setup:

```bash
npm run cloak:install
npm run chrome -- youtube
npm run login -- youtube cdp
npm run yt -- list
```

`npm run cloak:install` downloads the stealth Chromium binary (~200 MB, cached in `~/.cloakbrowser`). `npm run chrome -- youtube` starts that binary with default stealth flags, a dedicated service profile at `worker/cloak-profile/youtube`, and a CDP port. Log in normally in that window, keep it open, then run `login` to verify the session and export `worker/state/youtube.json`. The saved state and profile are ignored by git.

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
npm run worker:check -- --json   # machine-readable for monitoring
npm run stealth:test             # one-shot stealth verification (bot.sannysoft, BrowserScan, deviceandbrowserinfo)
```

This checks database reachability, browser mode, CloakBrowser binary status, saved state/profile paths, YouTube Music playlist reads and SoundCloud playlist reads. It does not perform write actions, so it will not create playlists or modify accounts.

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

By default runners use the saved state headlessly through the cloakbrowser binary. Set `WORKER_BROWSER=cdp` to operate against the already running stealth window, or `WORKER_BROWSER=profile` to reuse the full persistent profile for that service: `worker/cloak-profile/youtube` for YouTube Music and `worker/cloak-profile/soundcloud` for SoundCloud (legacy `worker/chrome-profile/<service>` is auto-detected if a newer profile does not exist yet). Set `HEADLESS=false` to debug visually, and `YT_DEBUG=true` to save screenshots/HTML under `worker/state`.

Extra worker env:

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_HUMANIZE` | `true` for youtube/soundcloud | Human-like mouse, keyboard, scroll (Bézier curves, per-char typing). Read-only runners disable it automatically for speed. |
| `WORKER_HUMAN_PRESET` | `default` | `default` or `careful` (slower, more deliberate) |
| `WORKER_HUMAN_TYPING_DELAY_MS` | preset value | Override `typing_delay` (ms per character). |
| `WORKER_HUMAN_MISTYPE_RATE` | preset value | Override `mistype_chance` (0.0 – 1.0). |
| `WORKER_HUMAN_IDLE_BETWEEN` | preset value | `true`/`false` — micro-movements between actions. |
| `WORKER_HUMAN_IDLE_RANGE_SEC` | preset value | Idle duration range, e.g. `0.3,0.8`. |
| `WORKER_PROXY` | — | `http://...` or `socks5://user:pass@host:port` |
| `WORKER_GEOIP` | `false` | Auto-detect timezone/locale from proxy exit IP |
| `WORKER_FP_SEED` | deterministic per service | Global fingerprint seed. Overrides the per-service default. |
| `WORKER_FP_SEED_YOUTUBE` / `..._SPOTIFY` / `..._SOUNDCLOUD` | — | Per-service override. Pin one device identity per account. |
| `WORKER_FP_PLATFORM` | auto (`windows` on Linux/Win, `macos` on Mac) | Force `--fingerprint-platform`. |
| `WORKER_STORAGE_QUOTA_MB` | — | Override storage quota in MB to bypass incognito detection. |
| `WORKER_DISABLE_HTTP2` | `false` | Force HTTP/1.1 for sites that challenge fresh HTTP/2 visitors. |
| `WORKER_WEBRTC_IP` | — | `auto` or explicit IP for `--fingerprint-webrtc-ip` (decoupled from geoip). |
| `WORKER_FP_NOISE` | `true` | Set `false` to disable canvas/WebGL/audio noise while keeping the deterministic seed. |
| `WORKER_SESSION_REUSE` | `false` locally, `true` in CI | Reuse one browser context per service across all calls within a sync rule. Big behavioral win in CI. |
| `WORKER_ACCOUNT_TIMEZONE` | `Europe/Riga` | IANA timezone for the active-hours check. |
| `WORKER_ACTIVE_HOUR_START` / `WORKER_ACTIVE_HOUR_END` | `7` / `24` | Local-hour window in which the worker is allowed to run. Outside → exits 0. |
| `WORKER_MAX_RULES_PER_RUN` | `2` in CI, `0` (no limit) locally | Cap on rules processed per cron tick. Smaller bursts run more often through a shorter cron interval. |
| `CLOAKBROWSER_BINARY_PATH` | — | Skip download, point at a local stealth binary. |
| `CLOAKBROWSER_AUTO_UPDATE` | `true` | Set `false` in CI to pin the binary to the bundled version. |

Persistent identity matters for account automation: by default each service gets a deterministic seed derived from its name, so YouTube and SoundCloud accounts see the same fingerprint across runs (returning-visitor pattern). To rotate, set `WORKER_FP_SEED_<SERVICE>` to a fresh integer.

If a target site challenges first-time HTTP/2 visitors, run the warm-up once to seed cookies in a persistent profile:

```bash
npm run warmup -- youtube
npm run warmup -- soundcloud
```

After that, normal runs work without `WORKER_DISABLE_HTTP2=true`.

This keeps Spotify and SoundCloud behavior unchanged. YouTube browser mode is best used locally or in a controlled worker process; it depends on a valid `worker/state/youtube.json`.

## Captcha Minimization

CloakBrowser prevents captchas; it does not solve them. The setup minimizes the chance that a captcha appears, and provides a manual fallback when one does.

**What helps the most, in order:**

1. **Residential proxy.** Datacenter IPs are flagged by reputation alone — no amount of stealth fixes that. Set `WORKER_PROXY=http://user:pass@residential-proxy:port` (or `socks5://...`). This is the single biggest factor for sites like SoundCloud, Google, Cloudflare-protected services. Combine with `WORKER_GEOIP=true` so timezone/locale match the exit IP.
2. **Deterministic fingerprint seed.** Already on by default — each service uses the same device identity across runs (returning-visitor pattern).
3. **Persistent profile + warm-up.** First-time visitors with no cookies are challenged more aggressively. Run `npm run warmup -- youtube` once after login to seed cookies with `--disable-http2`.
4. **Burst + long-pause write rhythm.** Short throttle 4–12s between writes (`WORKER_WRITE_THROTTLE_MIN_MS` / `..._SPREAD_MS`), then a longer 60–180s pause every 2–4 writes (`WORKER_WRITE_LONG_PAUSE_MIN_MS` / `..._SPREAD_MS`). Imitates a user adding tracks in bursts, not on a fixed cadence.
5. **Cron jitter.** The GitHub Action sleeps 0–30 min randomly before running, so syncs do not land at the same minute every time.
6. **Native sleep, not `page.waitForTimeout`.** Internal pauses use Node's `setTimeout`, which sends no CDP traffic that reCAPTCHA could detect.
7. **Service-wide 24h cooldown on captcha-class errors.** A captcha on YouTube halts **every** YouTube-touching rule for 24h, not just the one that hit. The cooldown is stored in `ServiceCooldown` and checked at the top of every sync-worker run.
8. **Session continuity per rule.** With `WORKER_SESSION_REUSE=true` (on in CI), all read/write calls for a sync rule reuse one browser context per service. Without it, each call would re-launch the browser — a strong "fresh script" signal.
9. **Active-hours window.** `WORKER_ACCOUNT_TIMEZONE` (default `Europe/Riga`) plus `WORKER_ACTIVE_HOUR_START` / `WORKER_ACTIVE_HOUR_END` (default `7` / `24`). Scheduled runs that fall outside the local waking window exit immediately. Real users do not log in at 3 a.m.
10. **Pre-action hover + dwell.** Before write-clicks the runner hovers the target and waits 300–1600 ms — matches how a real user reads a menu before tapping. Combined with `humanize` Bézier mouse paths from CloakBrowser.
11. **Shuffled rule order.** `dueRules` are processed in random order every run — no stable "rule A always first" pattern.

**When a captcha still appears, on the local machine:**

```bash
npm run captcha:solve -- youtube
npm run captcha:solve -- soundcloud
```

This opens the service in a headed stealth browser using the saved persistent profile. Solve the challenge by hand, return to the terminal, press Enter — the new storage state is exported. Then `npm run state:encode` to refresh secrets for CI.

**What does NOT help:**

- Free auto-solvers for reCAPTCHA v2 image / hCaptcha / Cloudflare Turnstile interactive — they do not exist at a reliable level. Paid solver APIs (2captcha, CapMonster) exist but cost money per challenge, and most modern sites detect automated solving anyway. Not integrated here on purpose.
- Solving reCAPTCHA v3. v3 is a score, not a puzzle. The stealth stack already targets a high score (0.9 in CloakBrowser tests). If you score low, the fix is residential proxy + humanize + fixed seed, not a "solver".

## Stage One Limits and Plans

The first stage uses mock data unless a browser runner or Spotify cookie is enabled. It does not store or download music, does not implement payments, PWA support or an admin panel. Next steps are stronger browser automation for all services, scheduled worker deployment, stronger deduplication and production hardening.

The sync engine is idempotent for the current mock flow: repeated runs reuse existing `TrackMatch`, pending `ManualMatchCandidate` and `PlaylistTrackState` records instead of creating duplicate rows. Sync logs are still written per run so history remains auditable.
