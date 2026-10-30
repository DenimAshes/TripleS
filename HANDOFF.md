# TripleS Handoff

## Project Goal

TripleS synchronizes playlists between Spotify, YouTube Music and SoundCloud.

Important product decision: **YouTube must not use YouTube Data API or Google OAuth API flows.** YouTube Music is controlled through a real browser session, as if a logged-in user is clicking and reading the web app.

## Current Stack

- Next.js 16 App Router + React 19
- Prisma + PostgreSQL/Neon
- TypeScript
- Playwright browser worker
- Windows local development path: `C:\Users\DrDyue\Documents\Noklusējuma projekts\TripleS`

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

## Design System

Everything visual resolves to a token in `app/globals.css`. A component that
spells out a colour, a shadow or a radius is a bug, because the same value then
drifts between pages.

- **Colour**: the studio-console palette uses booth black, graphite surfaces and
  signal cyan (`--accent`). Surfaces (`--bg`, `--surface`, `--surface-2/3`), text
  (`--text`, `--text-muted`, `--text-dim`), the accent with
  `-soft/-fg/-ring/-hover` plus `--on-accent`, and status tones all resolve to
  tokens. Brand colours live as `--brand-spotify|youtube|soundcloud` with a
  matching `-ink` and identify services only.
- **Radius**: two, plus a hairline. `--radius` (10px) wraps a container,
  `--radius-sm` (6px) wraps a control, `--hairline-radius` (4px) is only for
  shapes a few pixels across (row stripes, inline highlights). Write
  `rounded-[var(--radius-sm)]`, never `rounded-md`/`rounded-lg`.
- **Elevation**: `--shadow-overlay` for anything that floats (dialog, popover,
  toast) and `--scrim` for the dim behind it. Panels sit flat and get no shadow.
- **Frames**: a border means one of exactly three things, and `.panel` is down
  to eight uses app-wide. The thing floats free of the page flow (four overlays
  carrying `--shadow-overlay`, plus the login card), it carries a brand (the
  three service cards, each with a `serviceMeta().tint`), or it is a `Callout`
  carrying a status tone. Everything else groups with `.section` (a heading, a
  rule under it, content on the page background) and `.rows` (one hairline
  between rows, no frame or gap per row). If `.panel` is not one of those three
  cases, you want `.section` or `.rows`.
- **Type**: IBM Plex Sans carries the interface and Cyrillic playlist names;
  IBM Plex Mono is reserved for technical values. Five heading rungs use weight
  600 — `.heading-page` (24px, the h1),
  `.heading-card` (20px, a card standing for one whole thing), `.heading-section`
  (18px, a region or a dialog title), `.heading-panel` (16px, the commonest),
  `.heading-row` (14px, a row or list entry). `.eyebrow` (12px/600) is the small
  label that introduces a block; its tone comes from a colour utility, which
  outranks the components layer (`eyebrow text-muted-fg`). Nothing below the page
  title is heavier than the page title. The brand mark is three service faders,
  not a typographic monogram.
- **Vertical rhythm**: `.section` owns the gap between regions (2.5rem). Do not
  hand-roll `mt-10`/`mb-8`/`space-y-5` for it.
- **Shared classes**: `.section`, `.section-head`, `.rows`, `.panel`, `.workbench`, `.workbench-header`,
  `.panel-inset`, `.panel-accent`, `.btn` + `.btn-primary|ghost|danger`, `.pill`
  + `.pill-success|warning|danger|accent` and `.pill-spotify|youtube|soundcloud`,
  `.service-mark` (the brand tile behind a glyph), `.service-border`, `.kbd`,
  `.field-label`, `.heading-*`, `.eyebrow`, `.surface-lift`.
  `components/Callout.tsx` is the only inline message box.
- **`.surface-lift` is for links and buttons only.** On a plain div it promises a
  click target that is not there.
- **Service identity** comes from `serviceMeta()` in `components/ServiceBrand.tsx`:
  `tint` (sets `--service-glow` / `--service-ink` for descendants), `bg`,
  `border`, `pill`. It names tokens and never a colour.

Two Tailwind v4 traps this codebase already hit:

- Tailwind's default theme emits its own `--radius-*` into the same `:root`, so
  the project's `--radius-sm` and Tailwind's compete and source order decides.
  Ours wins today, which is why `rounded-sm` is 8px here. **A `:root` value on a
  key Tailwind already owns is dropped from the build** — that is why the
  hairline radius is `--hairline-radius`, outside the namespace. Overrides
  inside `@theme inline` for those keys are ignored too.
- Unlayered element defaults outrank every utility. Element rules belong in
  `@layer base`.

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

Design pass, second half — the sweep that finished the token migration:

- `ServiceBrand.tsx` no longer paints from Tailwind's palette. Its `soft` field was `bg-emerald-500/10 text-emerald-200 …`, so a Spotify pill was a different green from `--brand-spotify` everywhere it appeared. It now exposes `tint`/`bg`/`border`/`pill` built from the brand tokens, and `ServiceIcon` renders the shared `.service-mark` instead of its own fill and ink.
- `var(--accent-glow)` was referenced in seven places and defined nowhere, so each of those glows silently rendered as no shadow at all. Removed rather than resurrected: the pass had already dropped that language.
- Three surfaces were still on the pre-redesign glass look and are now plain panels: `ServiceCard`, `PlaylistTracksAutoRefresh`, and the hero on `/admin/sessions`. `SessionStalenessBanner` became a `Callout`, which is the twentieth hand-rolled message box that class has absorbed.
- The duplicated "which glow class for this service" ladders in `/connections`, `/playlists/[id]` and `SessionUploader` collapsed into `serviceMeta().tint`.
- Swept out of `app/` and `components/`: 16 raw hex values, 16 raw `white/`-`black/` alphas, 13 inline `rgba()`, 16 Tailwind palette classes, and six differently-tuned overlay shadows (now one `--shadow-overlay`). Four hand-rolled scrims became one `--scrim`.
- New shared classes for things that had been retyped inline: `.kbd` (seven copies), `.field-label` (one form used three different label treatments), `.pill-spotify|youtube|soundcloud`, `.service-mark`, `.service-border`.
- Every radius in the app now resolves to a project token: 90 `--radius-sm`, 19 `--radius`, 5 hairline, 13 `rounded-full`, and nothing else. `rounded-md` (a third value, 6px) is gone.
- Deleted `components/PlaylistCard.tsx` and `components/ConnectServiceButton.tsx`: unreferenced, and both still carried the old gradient-and-glow styling that would have reintroduced it if reused.
- Casing is now authored, not accidental: the dashboard queue printed `YOUTUBE`/`SOUNDCLOUD` raw, the staleness banner title-cased whole sentences via `capitalize`, and a session read "fresh" on the card and "Fresh" in the summary strip above it.
- The Spotify card on `/admin/sessions` was a bare panel next to two branded siblings; it now has the same icon, brand border and header shape.

Design pass, third half — typography, then de-framing. The first half of this
pass is deliberately near-invisible per screen; the second half is not:

- **The heading ladder.** 24 headings carried 15 different treatments and four weights, so the same section title was 24px on `/dashboard` and 18px on `/settings`, and a panel title inside a card ("Sync map", bold) outweighed the page's own `h1` (semibold) above it. Now five rungs, all 600. `font-bold` is gone except the two monogram tiles, where bold on a single glyph is the point.
- **`.text-accent-fg` meant two colours.** A hand-written copy in `@layer utilities` pointed at `--accent` while the `@theme` block's generated class pointed at `--accent-fg`, and source order decided: the base class rendered #4f8dff, its own `hover:` variant #bfd4ff. Deleting the hand-written copy also lifts those eleven 12px eyebrow labels from 5.9:1 to 12.4:1 contrast. **Do not re-add a `:root`/utility name that `@theme inline` already generates** — same trap as `--radius-sm`.
- **`surface-lift` was on ten non-interactive elements** — a count pill, stat tiles, panels, two search-field wrappers — each rising 1px and brightening its border on hover with nothing to click. Two hover effects were also plain broken: `group-hover:scale` on the `/playlists/[id]` hero artwork never fired (the section never declared `group`), and `SessionUploader`'s drop-zone glow fired from anywhere on the card because the nearest `group` was the whole section.
- **`/playlists/[id]` printed the playlist name twice** — as the AppShell `h1` and again in the hero right below it. It was the one page still doing what the shared header was introduced to stop, and the only page no `ui:shots` run had ever looked at. `scripts/ui-check.mjs` now discovers the first playlist at runtime and walks `/playlists/[id]` too.
- **De-framing.** `/dashboard` had 16 bordered containers nested four deep: the worker summary was a bordered box, inside a bordered box, inside a bordered panel, and its skipped-reason lines got a fourth frame. It is now 5, and the queue and worker are two sections instead of one panel with the second buried in it. `panel-inset` went 19 -> 7. Four sync-rule cards became divided rows; 18 playlist cards on `/playlists` became divided rows and the three service tabs became real tabs with a brand underline; 35 framed checkboxes inside three framed sections in `SyncRuleForm` became plain rows; the two browser labs lost three frames each and split their columns with a rule; the tracks table and `SyncLogTable` lost their frames and keep their header rule and row dividers. `/settings` and the labs separate their two columns with a hairline instead of boxing each side.
- Metric tiles across `/dashboard`, `/settings` and `SyncRuleGroupCard` had three different label weights and two tones; they are now `eyebrow text-muted-fg` with the number carrying the weight, and no frames.
- The three remaining hand-rolled message boxes (all in the add-sync dialog) became `Callout`s. That class has now absorbed 23.
- The dashboard's match-source strip printed the matcher's own keys at the reader — `no_match`, `search_manual`, `stored`. `matchSourceLabel()` maps the known ones and unpicks the rest from snake_case.
- Deleted `components/YouTubeBrowserConnector.tsx` and `components/SoundCloudConnector.tsx`: unreferenced, and both still carried the pre-flattening look (a panel holding three `panel-inset`s), so reusing either would have reintroduced it. Same reason `PlaylistCard` and `ConnectServiceButton` went last pass.
- `--text-dim` was lifted with the studio-console palette and now reaches 4.9:1 against `--surface-2`. It remains the tertiary tone; labels and explanations use `--text-muted`.

Design pass, fourth half — identity, responsive polish and the review workflow:

- Replaced the typographic `S` tile with a three-fader mark, moved the interface to IBM Plex Sans/Mono and rebuilt `/login` as a restrained control-room entry screen.
- The shared shell now has a skip link, safe-area spacing, a sticky console sidebar and a five-slot mobile bar. Setup-only Connections moved under More instead of squeezing six destinations across 390px.
- `/manual-match` shows one decision at a time, keeps bulk actions collapsed and reserves Skip for the whole song instead of repeating it beside every candidate. Its mobile grid now uses an explicit `minmax(0, 1fr)` track so controls cannot be clipped by intrinsic width.
- Form metadata, async status announcements, image dimensions, coarse-pointer targets and overlay semantics were tightened across the changed surfaces. `ui:shots` now covers `/manual-match` at 390px too.

Design pass, fifth half — dense mobile data:

- `/history` switches from a 720px scrolling table to compact semantic activity rows below 640px; filters now keep 44px touch targets.
- `/playlists/[id]` no longer overflows by 158px at 390px. Mobile rows keep artwork, match state and the external link while moving duration and secondary columns to wider layouts.
- The track list renders 50 rows at a time instead of 100, and the screenshot harness now checks mobile History plus the discovered playlist-detail route.

Structure pass — task-first page layouts:

- The shell now keeps global health/sign-out in navigation, leaving page headers for page context and one local action. Primary mobile navigation remains five items with safe-area spacing.
- `/dashboard` leads with actionable attention rows, keeps automation and the latest run compact, and collapses worker/rule diagnostics. The old connection-card grid and repeated run summary are gone.
- `/playlists` defaults to a thumbnail-led library. Creating a cross-service group is an explicit mode with a selected-playlist tray instead of controls on every row.
- `/settings` is now group-centric master/detail: choose one playlist group, then manage its platform members, source switches and shared behavior in one workspace. Legacy one-way rules remain under a secondary disclosure instead of being deleted or mixed into the primary model. Group settings save through `PATCH /api/playlist-groups/[groupId]`; saving also migrates matching legacy in-group routes to `TWO_WAY` without changing their source-enabled state.
- Connections are ordered as setup progress, next action, then one horizontal workspace per platform. Browser tools switch between playlist songs and song search rather than stacking both workflows.
- Destructive source and browser-track deletion now asks for confirmation. Async feedback has live-region semantics, service/library tabs expose state, and the UI harness ignores controls hidden inside closed disclosures.

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

UI verification (`scripts/ui-check.mjs`, needs `npm run dev` and `ADMIN_*` in `.env`):

- `npm run ui:shots` — screenshots every page at 1440 and 390 into `.design-audit/`, and fails on horizontal overflow, console errors or 4xx/5xx. Clean.
- `npm run ui:smoke` — walks every page, checks sidebar reachability and every internal link, then clicks buttons. Clean.
- **`ui:smoke` used to click mutating buttons.** It guarded itself with a blacklist of labels (`delete|accept|reject|refresh|…`), which fails open: `Use` and `Skip` on `/manual-match` were not on it, so a smoke run resolved real review items — 30 `TrackMatch` rows and 37 negative-cache entries, draining the pending queue to zero. It is now an allowlist of UI-only labels; anything unrecognised is skipped and printed under `not clicked:` so the coverage gap is visible instead of silent. It also re-queries each button before clicking, because a click that re-renders the list detached the handles it had captured and reported that as a failure.

## Next Work

1. Matching is calibrated from 35 real labels (32 accepted, 3 rejected). The auto threshold is now `0.85`: it had 100% precision on that sample, while `0.82` incorrectly accepted the live version of `Save Your Tears`. The review floor stays `0.65`; 34 ambiguous candidates remain for manual review. Competing alternatives now become `SUPERSEDED` and playlist-only exclusions become `EXCLUDED`, so neither pollutes future calibration as a false negative.
   Still open: the weighted score is `title 0.52 + artist 0.26 + duration 0.12 + album 0.10`, and SoundCloud never carries an album, so a pair with no usable duration tops out at 0.78 and can only reach the auto band through the exact-title/artist boost. Renormalizing over the signals actually present is the obvious next lever — after calibration, not before.
2. The scheduled worker only runs between 07:00 and 24:00 Europe/Riga (`WORKER_ACTIVE_HOUR_*`), so a night-time `workflow_dispatch` exits without doing anything. Widen the window locally when verifying.
3. YouTube reads are rate-sensitive: a run can still fail with `page.goto: net::ERR_TIMED_OUT` on a playlist page. The failure is transient and retried on the next tick, but repeated timeouts are worth watching.
4. Rows YouTube counts but renders without a watchable video keep large playlists a little under their declared count (159 of 171, 100 of 105). That is inside the 10% completeness tolerance; do not chase it as a bug.
5. Remote worker deployment is live: `.github/workflows/sync-worker.yml` runs every two hours. Sessions come from the `WorkerSessionState` table (see `npm run state:push`), not from the `*_STATE_GZIP_BASE64` secrets. A parked service is cleared with `npm run cooldown:clear`.
