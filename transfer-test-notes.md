# YouTube Music to SoundCloud transfer test notes

Date: 2026-05-14
Environment: local workspace at `c:\Users\DrDyue\Desktop\TripleS`, Neon Postgres from `.env`, browser automation enabled for YouTube and SoundCloud.

## Goal

Run an end-to-end pass for transferring a YouTube Music playlist named/containing "несчастливый" into SoundCloud by creating a new destination playlist, while recording failures, slow steps, and follow-up fixes.

## Timeline and observations

- 16:24 - Ran `npm run test`.
  - Result: passed.
  - Details: 10 test files, 47 tests, duration about 2.6s.
- 16:25 - Ran `npm run db:health`.
  - Result: passed.
  - Details: database reachable, 1 user, 15 playlists, 2 sync rules.
- 16:25 - Ran `npm run worker:check`.
  - Result: partial pass with warnings.
  - Details: environment and database are OK; CloakBrowser is installed; YouTube and SoundCloud state/profile files exist.
  - Issue: live browser checks were skipped by default, so this does not prove the saved sessions are still valid.
- 16:26 - Tried to start the dev server with PowerShell `Start-Process` and a single combined log file.
  - Result: failed before the server started.
  - Issue: PowerShell rejects using the same file for `RedirectStandardOutput` and `RedirectStandardError`.
  - Fix for process: use separate stdout/stderr log files when starting background processes on Windows.
- 16:27 - Started the dev server with separate stdout/stderr logs.
  - Result: server is up at `http://127.0.0.1:3000`.
  - `/api/health`: OK.
  - Observation: dev log printed `[youtube] Running in MOCK mode` and `[soundcloud] Running in MOCK mode` while compiling `/api/health`; this may be benign module initialization, but it is confusing during a browser-automation transfer test.
- 16:27 - Tried to use `agent-browser` for dev-server verification.
  - Result: unavailable in PATH.
  - Workaround: continue browser verification with the project's Playwright dependency.
- 16:28 - Opened the app in Playwright.
  - Result: already authenticated and redirected to `/dashboard`.
  - Console: no warnings/errors at this point.
  - Dashboard shows rule `несчастливый плейлист YouTube -> SoundCloud`.
- 16:29 - Opened the existing rule settings.
  - Source: `YOUTUBE: несчастливый плейлист`.
  - Destination: `SOUNDCLOUD: несчастливый плейлист`.
  - Mode: `Add new songs`.
- 16:29 - Opened the YouTube playlist page and clicked `Add sync`.
  - Result: modal supports creating a new SoundCloud playlist.
  - Issue: service tabs show both `SoundCloud` and `soundcloud`, which looks like inconsistent service casing in stored playlist rows.
- 16:30 - Tried to create `несчастливый плейлист test 2026-05-14 16-30` through the `Add sync` modal.
  - Result: failed.
  - UI error: `Could not create playlist.`
  - Browser console: `POST /api/playlist-groups` returned 500.
  - Server log cause: the spawned SoundCloud runner exits on `_runnerGuard`: `Worker runners (worker/runners/*.ts) must not be imported from app/server code...`
  - UX issue: the UI hides the actionable server error and only shows a generic message.
- 16:30 - Ran `npm run worker:check:live`.
  - Result: timed out after about 244s in this test shell.
  - Issue: live check is too slow/hanging for a quick preflight and did not produce useful progress output before timeout.
- 16:30 - Ran `npm run sc -- list` directly.
  - Result: passed, but took about 185s.
  - Output: only 2 live SoundCloud playlists were returned: `На фонтане` and read-only `HardTEKK`.
  - Data mismatch: UI/settings show additional SoundCloud playlist rows such as `Амстердамм` and `несчастливый плейлист`, but live SoundCloud list does not return them.
- 16:35 - Clicked `Run now` for `несчастливый плейлист YouTube -> SoundCloud` on the dashboard.
  - Result: failed.
  - Browser console: `POST /api/sync/run` returned 500.
  - Server log cause: preflight failed because source playlist `YOUTUBE: несчастливый плейлист` has incomplete cache: `1/105 active`.
  - Required next step: refresh the YouTube playlist tracks before sync can run.
- 16:36 - Clicked `Update` on the `YOUTUBE: несчастливый плейлист` page.
  - Result: failed.
  - UI shows the full `_runnerGuard` error for the YouTube runner.
  - Cause: same app/API spawned-runner issue as SoundCloud creation.
- 16:36 - Ran `npm run yt -- tracks "PLkEG3hafrR62cGvCWVvkFHF4h701qXm_g"` directly.
  - Result: passed, but took about 191s.
  - Output: 95 tracks found.
  - Data mismatch: app playlist count is 105, direct live runner returned 95, and app cache currently has only 1 active track.
- 16:40 - Ran `npm run sc -- create "несчастливый плейлист test 2026-05-14 16-40"` directly.
  - Result: passed, but took about 184s.
  - Created SoundCloud playlist: `https://soundcloud.com/drdyue/sets/neschastlivyj-plejlist-test/s-5JxaW6CIuND`
  - Conclusion: the SoundCloud write session is alive; the app/UI failure is caused by the app-spawned runner environment, not by a SoundCloud write block.

## Issues and follow-ups

- Fixed in this pass: app-spawned browser runners no longer inherit `NEXT_RUNTIME`/`NEXT_PHASE`, so `_runnerGuard` can still block real server imports while allowing one-shot CLI subprocesses.
- Fixed in this pass: Prisma Client was regenerated and pending Neon migrations were applied. Before this, the app crashed because the database was missing `Playlist.apiId`.
- Fixed in this pass: `/api/playlist-groups` and `/api/sync/run` now return JSON error messages instead of only throwing server 500s.
- Fixed in this pass: `Run now` now shows the backend error in the dashboard UI.
- Fixed in this pass: the `Add sync` service tabs normalize service casing, so the modal no longer shows both `SoundCloud` and `soundcloud`.
- Fixed in this pass: SoundCloud create no longer does a live playlist `list` before creating a playlist. The pre-list was slower than the create path and could time out before the real action.
- Changed in this pass: YouTube/SoundCloud runner timeouts were raised to 10 minutes; SoundCloud CLI retries default to 0 to avoid multi-minute duplicate attempts.
- `worker:check` is useful but too shallow for a real transfer pass because it skips live browser validation. For this workflow, run `npm run worker:check:live` before assuming the YouTube/SoundCloud sessions will work.
- Local dev-server startup commands on Windows need separate stdout/stderr redirect targets. This should be documented in the handoff or scripts if background startup is a common test path.
- `agent-browser` verification instructions are not directly runnable in this workspace because the CLI is not installed or not in PATH. Use Playwright fallback or install/expose the CLI.
- The startup log's mock-mode messages are misleading when `YOUTUBE_BROWSER_AUTOMATION=true` and `SOUNDCLOUD_BROWSER_AUTOMATION=true`. Confirm whether these logs come from unused adapters or actual runtime adapter resolution.
- The playlist connection modal shows duplicate service tabs: `SoundCloud` and `soundcloud`. Normalize service casing in persisted playlist rows and UI grouping; otherwise users can create/connect against the wrong bucket.
- Creating a destination playlist through the app currently fails before reaching SoundCloud because the browser runner trips `_runnerGuard` when spawned from the app/API path. Fix `runBrowserRunnerCli`/runner invocation so spawned runner entrypoints are allowed without weakening the guard for actual imports.
- The create-playlist modal should surface the backend error details, at least in a collapsible diagnostic line, because `Could not create playlist.` is not enough to repair the session/configuration problem.
- `npm run worker:check:live` needs progress logs and/or per-service timeouts. A 4-minute silent hang is too long for a preflight.
- Direct SoundCloud live listing is very slow (~185s) and returns fewer playlists than the app has cached. Need reconcile stale DB rows after refresh and investigate why the live API/fallback only returns 2 playlists.
- Sync preflight correctly blocks incomplete source data, but the dashboard does not explain the reason after `Run now`; it just leaves the user on the page with a console 500. Show the preflight reason in the UI and provide a direct `Refresh source tracks` action.
- YouTube live extraction is slow (~191s) and returns 95 tracks for a playlist counted as 105 in the app. Need decide whether the UI count is stale, the runner misses lazy-loaded/hidden tracks, or unavailable tracks are counted but not extractable.
- Direct SoundCloud playlist creation works but is also slow (~184s). If this is normal, the UI needs a long-running job/progress model; a synchronous modal action will feel broken.
- Retest after fixes: app/API SoundCloud creation no longer hits `_runnerGuard`, but it still runs longer than normal browser/tool request limits. One API attempt timed out client-side at 380s while the server logged a 200 after about 6.3 minutes. This needs a background job model with polling instead of a single blocking HTTP request.
