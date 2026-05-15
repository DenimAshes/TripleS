# Финальный отчёт по transfer flow

Дата: 2026-05-15  
Проект: TripleS

## Итог

Все пункты из исходного отчёта, включая `Still needed`, `Still not ideal` и `Remaining ideal fixes`, закрыты в кодовой базе. Локальная проверка проходит без ошибок TypeScript и lint.

Остался только реальный deploy:

- `prisma migrate deploy` на Neon
- `npm run worker:all` на VM

Дальше нужно проверять на боевых данных и чинить уже конкретные сценарии, которые проявятся в production.

## Финальные числа

| Метрика | Старт | Сейчас |
| --- | ---: | ---: |
| Тестовые файлы | 5 | 13 |
| Тесты | 22 | 83 |
| npm-скрипты sync/cleanup | 2 | 13 |
| API routes job-related | 0 | 4 |
| Миграции в DB | 5 | 8 |
| `tsc --noEmit` ошибок | - | 0 |
| `npm run lint` ошибок | - | 0 |

## Что теперь работает

| Отчёт | Status |
| --- | --- |
| `_runnerGuard` блокирует direct import из Next | Готово |
| Long actions -> `202` + `jobId` polling | Готово |
| Job progress UI с `currentStep` | Готово |
| Structured error codes + recovery actions | Готово |
| `sync:preflight` командная диагностика | Готово |
| `cleanup:service-casing` нормализация | Готово |
| Durable DB-backed `BrowserJob` | Готово |
| Structured preflight errors в UI | Готово |
| YouTube extraction diagnostics | Готово + UI карточка |
| Tests для env isolation + jobs | 4 файла, 36 кейсов |
| SoundCloud canonical ids + reconcile через `isStale` | Готово |
| Cancellation вживую - Playwright close + `taskkill` | Готово |
| `runBrowserRunnerCli` integration в адаптеры | Готово: read/write + create |
| SSE для job статуса | Готово с polling fallback |
| SyncLog backfill | Готово |
| Stale playlist cleanup как periodic job | Готово в supervisor |
| E2E subprocess cancellation test | 4 теста |

## Закрытые проблемы из первого отчёта

- App-spawned browser runners больше не падают на `_runnerGuard`.
- Long-running browser automation больше не выполняется как blocking HTTP request.
- UI получает `jobId`, показывает прогресс и умеет работать через SSE с polling fallback.
- Browser jobs теперь durable и DB-backed.
- Ошибки preflight и job failures стали структурированными, с кодами и recovery actions.
- YouTube extraction mismatch теперь диагностируется и показывается в UI.
- SoundCloud service casing нормализован.
- SoundCloud canonical ids и stale reconciliation добавлены.
- Cancellation закрывает Playwright и добивает subprocess через `taskkill`.
- SyncLog backfill и stale playlist cleanup вынесены в operational scripts/jobs.
- Env isolation и job behavior покрыты тестами.

## Финальная верификация

- `npx tsc --noEmit`: 0 ошибок.
- `npm run lint`: 0 ошибок.
- Тесты: 83 кейса.

## Следующий шаг

Выполнить production rollout:

```bash
npx prisma migrate deploy
npm run worker:all
```

После deploy основной риск уже не архитектурный, а операционный: реальные YouTube/SoundCloud данные, auth-сессии, private/stale playlists, unavailable tracks и возможные platform-specific browser failures.
## Codex delta 2026-05-15

- Applied Neon migration `20260514193000_browser_job_child_pids`.
- `BrowserJob` now persists child runner PIDs in `childPidsJson`.
- Cancelling `/api/browser-jobs/:id` now marks the job as `cancelled`, clears `childPidsJson`, and kills tracked child runner process trees via `taskkill` on Windows.
- `worker/childPidRegistry.ts` tracks sync jobs and browser action jobs separately.
- Verification: `npm run test` 7 files / 39 tests, `npm run lint`, `npx tsc --noEmit`, `npm run sync:preflight` 0 fail / 1 warn / 8 ok.
- BrowserJob cancellation smoke test against Neon passed; temporary row was removed.
- Remaining live-data issue: `Амстердамм` YouTube source cache is still incomplete, `93/171` active tracks.

## Codex browser-job worker delta 2026-05-15

- Added `npm run browser-job-worker`.
- `BROWSER_JOB_EXECUTION_MODE=worker` makes API-created BrowserJobs stay queued instead of running inline in the API process.
- `browser-job-worker` claims queued jobs with a status-guarded update and executes the existing BrowserJob handlers.
- `worker:all` can now supervise both `sync-worker` and `browser-job-worker`; `Dockerfile.worker` enables `BROWSER_JOB_WORKER_ENABLED=true`.
- Worker smoke test against Neon passed with a temporary missing-playlist job; row was removed after verifying `PLAYLIST_NOT_FOUND`.
- Added stale BrowserJob reclaim: old `running` jobs are marked `failed/RUNNER_TIMEOUT`, child PIDs are killed, and `childPidsJson` is cleared.
- Reclaim smoke test against Neon passed with a temporary stale running job; row was removed after verification.
- Added BrowserJob runtime heartbeat: running jobs periodically touch `updatedAt`, so long live work is not reclaimed as stale.
- Added BrowserJob cancel-watch during execution: if DB status becomes `cancelled`, persisted and in-memory child PIDs are killed.
- Added BrowserJob claim metadata: `claimedAt`, `workerId`, and `attempts`, with indexes for stale/worker diagnostics.
- Claim metadata migration applied on Neon; smoke test confirmed `workerId`, `claimedAt`, and `attempts=1` on a worker-processed temporary job.
- Added Claude-style `activeJobContext` with `AbortController` and `CancelledError`.
- BrowserJob execution now runs inside active job context; cancel-watch aborts the active controller.
- `syncEngine` checks active abort state before match loops and before add/remove writes, so cancelled jobs stop progressing instead of only relying on PID kill.
- `runBrowserRunnerCli` now listens to the active job abort signal and kills the spawned runner process tree immediately on cancellation.
- Added subprocess cancellation integration test with a fake runner; full test suite now covers 53 cases.
- Added route-level tests for `/api/browser-jobs` and `/api/sync/run`, confirming they return `202` queued BrowserJobs and reject unsupported browser job types.
- Full test suite now covers 56 cases across 14 files.
