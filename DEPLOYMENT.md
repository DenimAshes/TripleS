# TripleS Hosted Deployment

Target architecture:

- Vercel Hobby: Next.js web app and custom domain.
- Neon Free: shared PostgreSQL database.
- GitHub Actions or a free VM: remote stealth-browser worker (CloakBrowser) for scheduled sync jobs.
- GitHub Secrets / Vercel Environment Variables: credentials and browser session state.

This keeps the app usable from a domain while avoiding local files on your computer after setup. Browser automation should not run as the main scheduled worker inside Vercel functions because free Hobby functions have short execution limits and no persistent browser profile.

Browser write actions are most reliable with a trusted persistent profile. GitHub Actions uses `WORKER_BROWSER=state`, which restores cookies/localStorage from secrets and runs through the CloakBrowser stealth binary. A VM can use `WORKER_BROWSER=profile`, which keeps a full persistent profile between runs and behaves closer to a normal browser session.

If you do not want GitHub Actions, use the VM path below. The clean free-server target is:

- Vercel for the public web app, or the VM web container if you want one machine to host everything.
- Neon for Postgres.
- A free Linux VM for stealth-browser worker scheduling.

## Required Services

1. Create a GitHub repository for this project.
2. Create a Neon Postgres project and keep its pooled `DATABASE_URL`.
3. Create a Vercel project connected to the GitHub repository.
4. Add your domain in Vercel project settings.

Use Node.js 20 or 22 LTS for deployment tooling. Node 25 can trip package engine checks in current Vercel CLI dependency trees.

## Vercel Environment Variables

Set these in Vercel for Production and Preview:

```txt
DATABASE_URL
DIRECT_URL
ADMIN_EMAIL
ADMIN_PASSWORD
JWT_SECRET
ENCRYPTION_KEY
CRON_SECRET
YOUTUBE_BROWSER_AUTOMATION=true
SOUNDCLOUD_BROWSER_AUTOMATION=true
```

## GitHub Actions Secrets

Set the same server secrets in GitHub Actions, plus browser state:

```txt
DATABASE_URL
DIRECT_URL
JWT_SECRET
ENCRYPTION_KEY
CRON_SECRET
YOUTUBE_STATE_GZIP_BASE64
SOUNDCLOUD_STATE_GZIP_BASE64
```

Generate compressed browser state secrets from an already logged-in local session:

```powershell
npm run --silent state:encode -- youtube
npm run --silent state:encode -- soundcloud
```

Paste each output into the matching GitHub secret. The older `YOUTUBE_STATE_JSON_BASE64` and `SOUNDCLOUD_STATE_JSON_BASE64` names still work, but the compressed `*_GZIP_BASE64` values are much smaller and fit GitHub's secret size limit more reliably. After that, the scheduled worker restores `worker/state/*.json` in the GitHub runner and your computer does not need to keep those files for normal operation.

## Database Setup

Run migrations against the hosted Neon database:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:DIRECT_URL="postgresql://..."
npx prisma migrate deploy
npx prisma db seed
npm run db:health
```

`DATABASE_URL` should use the pooled Neon connection for the app. `DIRECT_URL` should use Neon's direct connection string for migrations. If `DIRECT_URL` is not set, the build script falls back to `DATABASE_URL`.

For production, replace the default admin password immediately through a safer account flow before sharing the domain.

`npm run db:health` should print counts for users, playlists and sync rules. The app also retries transient Prisma connection errors a few times, which helps with Neon cold starts and short network hiccups. Tune with:

```txt
PRISMA_TRANSIENT_RETRIES=2
```

## Scheduled Sync

The workflow at `.github/workflows/sync-worker.yml` runs every 6 hours and can also be started manually from GitHub Actions. It:

1. Installs dependencies.
2. Installs Playwright Chromium.
3. Restores YouTube/SoundCloud session state from secrets.
4. Runs `npm run sync-worker`.

GitHub Actions is good for scheduled read-heavy sync. If a service asks for captcha or blocks write requests, refresh the browser session locally or use the VM profile mode below.

## VM Worker Without GitHub Actions

The repo includes Docker and systemd files for a Linux VM:

```txt
Dockerfile
Dockerfile.worker
docker-compose.vm.yml
deploy/systemd/triples-worker.service
deploy/systemd/triples-worker.timer
deploy/caddy/Caddyfile
.env.production.example
```

On the VM:

```bash
sudo mkdir -p /opt/triples
sudo chown "$USER:$USER" /opt/triples
cd /opt/triples
```

Copy the project there, then create `.env.production` from `.env.production.example`.

Generate browser-state secrets before deleting local state:

```powershell
npm run --silent state:encode -- youtube
npm run --silent state:encode -- soundcloud
```

Put the outputs into `.env.production` as:

```txt
YOUTUBE_STATE_GZIP_BASE64="..."
SOUNDCLOUD_STATE_GZIP_BASE64="..."
```

For a VM that should keep a full trusted browser profile instead of only storage-state JSON, set:

```txt
WORKER_BROWSER="profile"
HEADLESS="false"
CLOAKBROWSER_AUTO_UPDATE="false"
```

Pre-download the stealth Chromium binary once (~200 MB, cached in `~/.cloakbrowser`):

```bash
npm run cloak:install
```

Then start the stealth browser once with the same service profile, log in and pass any service checks:

```bash
npm run chrome -- youtube
npm run login -- youtube cdp

npm run chrome -- soundcloud
npm run login -- soundcloud cdp
```

After that, scheduled worker runs reuse `worker/cloak-profile/youtube` for YouTube Music and `worker/cloak-profile/soundcloud` for SoundCloud (legacy `worker/chrome-profile/<service>` is also picked up automatically if it exists from earlier setups). This does not solve captcha automatically; it makes the worker use the same long-lived browser profiles after you pass checks manually.

The deterministic per-service fingerprint seed makes each account look like the same returning device across runs. Override per-service with `WORKER_FP_SEED_YOUTUBE`, `WORKER_FP_SEED_SOUNDCLOUD`, etc. when rotating identity.

Build and start the web app on the VM:

```bash
docker compose -f docker-compose.vm.yml up -d --build web
docker compose -f docker-compose.vm.yml run --rm worker
```

Install the timer:

```bash
sudo cp deploy/systemd/triples-worker.service /etc/systemd/system/
sudo cp deploy/systemd/triples-worker.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now triples-worker.timer
systemctl list-timers triples-worker.timer
```

If the VM also hosts the domain, install Caddy and copy `deploy/caddy/Caddyfile` to `/etc/caddy/Caddyfile`, replacing `YOUR_DOMAIN`. Vercel remains simpler for the public web app, but the VM path works when you want everything outside your computer without relying on GitHub Actions.

## Health Checks

Public app health:

```txt
GET /api/health
```

Database health:

```txt
GET /api/health/db
```

Local CLI:

```bash
npm run db:health
npm run worker:check
```

## Current Limitation

SoundCloud read operations work remotely with saved state. SoundCloud add/remove currently hit SoundCloud captcha/403 in the tested session when using the internal web API. Full remote sync into SoundCloud requires either a UI-click fallback or a way to refresh/pass SoundCloud's captcha challenge.
