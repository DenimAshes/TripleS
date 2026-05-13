# TripleS Handoff

## Project Goal

TripleS synchronizes playlists between Spotify, YouTube Music and SoundCloud.

Important product decision: **YouTube must not use YouTube Data API or Google OAuth API flows.** YouTube Music is controlled through a real browser session, as if a logged-in user is clicking and reading the web app.

## Current Stack

- Next.js 16 App Router + React 19
- Prisma + PostgreSQL/Neon
- TypeScript
- Playwright browser worker
- Windows local development path: `c:\Users\DrDyue\Desktop\TripleS`

## Current YouTube Architecture

Browser-only flow:

```txt
worker/chrome.ts              starts real Chrome with a dedicated profile
worker/login.ts               verifies login and exports storage state
worker/browserSession.ts      opens saved state in real Chrome/Chromium
worker/runners/youtube.ts     list/search/add/remove through YouTube Music UI
lib/services/youtube/YouTubeBrowserAdapter.ts
lib/services/youtube/youtubeBrowserCli.ts
lib/services/adapterFactory.ts
```

Setup commands:

```bash
npm run chrome
npm run login -- youtube cdp
npm run yt -- list
```

Runner commands:

```bash
npm run yt -- list
npm run yt -- tracks "PL..."
npm run yt -- search "Artist - Track"
npm run yt -- add "Playlist name or PL..." "Artist - Track"
npm run yt -- remove "PL..." "Track title or video id"
```

To make the main sync engine use YouTube browser automation:

```env
YOUTUBE_BROWSER_AUTOMATION="true"
```

## What Was Fixed In The Latest Pass

- Removed the YouTube Data API/device-code path.
- Removed `youtube:device` and `yt:data` scripts.
- Removed Google OAuth route stubs.
- Settings now shows `YouTube Music browser`, not API setup.
- `openWorkerBrowser` now uses real Chrome channel for Chromium/state modes when available.
- Saved YouTube state no longer launches in Firefox.
- Fixed YouTube Music returning "browser outdated" by using real Chrome + Chrome user-agent.
- `npm run yt -- list` works against the saved session and found 9 playlists.
- `npm run yt -- tracks "PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc"` returns 6 tracks, matching the playlist count.
- Search results are deduplicated and basic localized media-type labels are cleaned.
- Tested browser add/remove on playlist `PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc` (`Mans atskanosanas saraksts Nr. 23`) with `Rick Astley Never Gonna Give You Up`; the test track was removed and the playlist is back to 6 tracks.
- Hardened YouTube Music removal by hovering the row and force-clicking the row action menu, which is sometimes covered by YouTube Music layout layers.
- Added `/youtube-browser`, a web UI for YouTube Music browser automation with playlist loading, track viewing, search, add and remove controls.
- Added internal `/api/youtube-browser/*` routes. They call the existing `worker/runners/youtube.ts` CLI in a child Node process so Next/Turbopack does not directly bundle Playwright into the route module.
- Improved `/youtube-browser` operation states: long browser actions now show explicit status text, errors and empty states.
- Added duplicate detection before YouTube add operations. It checks `videoId`, ISRC, normalized title/artist and normalized query/title overlap before clicking add.
- `npm run yt -- add ...` now also skips duplicates and prints `Already in playlist`.
- `YouTubeBrowserAdapter` now uses `youtubeBrowserCli.ts`, so the main sync path and web UI share the same browser-only runner path.
- Playlist refresh now allows real YouTube browser mode even if the existing seeded YouTube account was marked as mock. With `YOUTUBE_BROWSER_AUTOMATION=true`, refresh can upsert real YouTube playlists into the database.
- Fixed PostgreSQL runtime bug in Spotify cookie storage by replacing raw SQL with Prisma Client API.
- Added the SoundCloud browser-backed path: `worker/runners/soundcloud.ts`, `npm run sc -- list|tracks|search|add|remove|create`, `SoundCloudBrowserAdapter`, settings card, and `SOUNDCLOUD_BROWSER_AUTOMATION`.
- Added `/soundcloud-browser` plus internal `/api/soundcloud-browser/*` routes for playlist loading, track viewing, search, add and remove controls.
- Added `lib/services/soundcloud/soundcloudCache.ts` so the SoundCloud browser tools can reuse DB and memory cache behavior similar to the YouTube browser tools.
- SoundCloud read operations are verified. Write operations are implemented but currently blocked by SoundCloud captcha/anti-abuse on the internal playlist update API in the tested session.

## Verification

Passed:

```bash
npm run lint
npm run test
npm run build
npm run yt -- list
npm run yt -- tracks "PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc"
npm run yt -- search "The Weeknd Blinding Lights"
npm run yt -- add "PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc" "Rick Astley Never Gonna Give You Up"
npm run yt -- remove "PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc" "dQw4w9WgXcQ"
npm run yt -- add "PLkEG3hafrR607OtRgPKwpOFniIvCp_4hc" "Kai Angel quiet turn up"
```

SoundCloud verification:

- `worker/state/soundcloud.json` exists.
- `npm run sc -- list` found 2 playlists, including writable `drdyue/sets/na-fontane`.
- `npm run sc -- tracks "drdyue/sets/na-fontane"` returned 86 tracks.
- `npm run sc -- search "The Weeknd Blinding Lights"` returned 40 tracks.
- `npm run sc -- add "drdyue/sets/na-fontane" "theweeknd/blinding-lights"` was blocked by SoundCloud API 403 captcha, so write-flow needs a UI-based fallback or a manual captcha recovery path before it can be considered production-ready.

Browser verification:

- `http://127.0.0.1:3000/settings` loads.
- `http://127.0.0.1:3000/youtube-browser` loads.
- `http://127.0.0.1:3000/soundcloud-browser` exists and uses the new SoundCloud browser API routes.
- YouTube browser block is visible.
- No browser console errors.

## Next Work

1. Harden SoundCloud write-flow: current API PUT can return captcha 403. Either add a UI-click fallback in the real Chrome session or document a manual captcha recovery step.
2. Browser-verify `/soundcloud-browser` after starting the dev server.
3. Run a full sync-rule flow against a disposable writable playlist once SoundCloud write-flow is unblocked.
4. Design remote worker deployment. Most practical free path is GitHub Actions cron with `worker/state/*.json` stored as secrets and restored before sync.
