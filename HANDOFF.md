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
- SoundCloud reads are verified. Writes no longer use the `api-v2` `PUT /playlists/{id}` route: DataDome answers it with an interstitial challenge (`t=it`) even from the logged-in page context, on a residential IP, with a live `datadome` cookie. Passing the device check refreshes the cookie but the next write is challenged again.
- SoundCloud's current layout (`/n/<track>?v2_layout=true`) writes through a same-origin server action instead: `POST /n/<track>` with `[{"trackUrns":[...],"playlistUrn":"..."}]`. That endpoint is not challenged, so `worker/runners/soundcloudUiWrite.ts` drives the "Add to playlist" dialog and the api-v2 write is only a fallback (`SOUNDCLOUD_WRITE_MODE=auto|ui|api`).
- Verified headless on `Снимите тонер`: add moved it 3 -> 4 tracks and remove took it back to 3, both confirmed by the row label flipping between `Add to playlist` and `Added`, with the server action returning 200 each time.
- The SoundCloud account handle is now `lightblesss`, not `drdyue`. Writable playlists: `lightblesss/sets/na-fontane` and `lightblesss/sets/kalvin-klyajn`.
- The dialog lists playlists that `api-v2` playlist listing omits (`Снимите тонер`, `несчастливый плейлист`), and its track counts can lag the API by a few entries.

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
- `npm run sc -- list` found 2 playlists, including writable `lightblesss/sets/na-fontane`.
- `npm run sc -- search "The Weeknd Blinding Lights"` returned 40 tracks.
- `npm run sc -- add "lightblesss/sets/na-fontane" "theweeknd/blinding-lights"` reported `add via UI applied` and `{ "added": true }`.
- `npm run sc -- remove "lightblesss/sets/na-fontane" "theweeknd/blinding-lights"` reported `remove via UI applied` and `{ "removed": true }`, leaving the playlist at its original 83 tracks.

Browser verification:

- `http://127.0.0.1:3000/settings` loads.
- `http://127.0.0.1:3000/youtube-browser` loads.
- `http://127.0.0.1:3000/soundcloud-browser` exists and uses the new SoundCloud browser API routes.
- YouTube browser block is visible.
- No browser console errors.

## Next Work

1. Playlist creation (`create`, `create-b64`) still goes through `api-v2` and still hits the DataDome block. The dialog has a `Create playlist` entry, so the same UI path can cover it.
2. Run a full sync-rule flow end to end now that SoundCloud writes land, and clear the `serviceCooldown` rows left over from the captcha failures.
3. YouTube source reads can come back incomplete on large playlists (90 of 171 tracks on `Амстердамм`), which the snapshot guard correctly refuses. Scroll/pagination in the YouTube runner needs work for playlists of that size.
4. Remote worker deployment is live: `.github/workflows/sync-worker.yml` runs every two hours. Sessions come from the `WorkerSessionState` table (see `npm run state:push`), not from the `*_STATE_GZIP_BASE64` secrets.
