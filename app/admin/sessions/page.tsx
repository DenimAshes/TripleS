import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyCookieConnector } from "@/components/SpotifyCookieConnector";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";

// Browser-storage-state-backed services. Spotify is intentionally left out
// — it uses the sp_dc web cookie (handled by SpotifyCookieConnector below)
// not a Playwright storageState dump.
const BROWSER_SERVICES = ["youtube", "soundcloud"] as const;

export default async function AdminSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, spotifyAccount, spotifyCookie] = await Promise.all([
    prisma.workerSessionState.findMany({
      where: { service: { in: BROWSER_SERVICES as unknown as string[] } },
    }),
    prisma.connectedAccount.findUnique({
      where: { userId_service: { userId: session.userId, service: "SPOTIFY" } },
    }),
    getSpotifyWebCookie(session.userId),
  ]);

  const byService = new Map(rows.map((r) => [r.service, r]));
  const browserSessions = BROWSER_SERVICES.map((service) => {
    const row = byService.get(service);
    return {
      service,
      exists: !!row,
      bytes: row?.bytes ?? 0,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });

  return (
    <AppShell title="Worker sessions">
      <div className="space-y-6">
        <section className="panel p-5 text-sm text-muted-fg">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">
            How to refresh a session
          </h2>
          <p className="mb-2 text-xs text-muted-fg">
            <strong className="text-[var(--text)]">Spotify</strong> uses just one cookie value
            (<code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">sp_dc</code>) — paste it in the
            Spotify card below.
          </p>
          <p className="mb-3 text-xs text-muted-fg">
            <strong className="text-[var(--text)]">YouTube Music</strong> and{" "}
            <strong className="text-[var(--text)]">SoundCloud</strong> use a full Playwright storageState dump —
            export it from Cookie-Editor:
          </p>
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>
              In your personal browser, log in to the service (e.g.{" "}
              <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">music.youtube.com</code>).
            </li>
            <li>
              Install the free{" "}
              <a
                className="text-[var(--accent)] hover:underline"
                href="https://cookie-editor.com/"
                target="_blank"
                rel="noreferrer"
              >
                Cookie-Editor
              </a>{" "}
              extension (open source, MIT).
            </li>
            <li>
              Open the extension on the logged-in tab → <strong className="text-[var(--text)]">Export</strong> →{" "}
              <strong className="text-[var(--text)]">Export as Playwright</strong> if available, otherwise{" "}
              <strong className="text-[var(--text)]">Export as JSON</strong> (bare cookie array also works).
            </li>
            <li>
              Drop the downloaded JSON into the matching card below, or expand <em>Or paste JSON</em> and Ctrl+V the
              contents.
            </li>
            <li>The next scheduled sync run will use the refreshed session.</li>
          </ol>
          <p className="mt-3 text-xs text-dim-fg">
            State is stored gzipped in the database and read by the GitHub Actions sync worker on every run. Nothing
            is written to disk on Vercel.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Spotify (sp_dc cookie)</h2>
          <SpotifyCookieConnector
            hasCookie={Boolean(spotifyCookie)}
            serviceUsername={spotifyAccount?.serviceUsername}
            connectionStatus={spotifyAccount?.connectionStatus}
            lastError={spotifyAccount?.lastError}
          />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">
            Browser-automation sessions (YouTube / SoundCloud)
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {browserSessions.map((s) => (
              <SessionUploader key={s.service} initial={s} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
