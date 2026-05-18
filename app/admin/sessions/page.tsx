import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyCookieConnector } from "@/components/SpotifyCookieConnector";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
import {
  getSpotifyRedirectUri,
  hasSpotifyCredentials,
  validateSpotifyRedirectUri,
} from "@/lib/services/spotify/spotifyAuth";

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

  // Compute the redirect URI the user must paste into Spotify Developer
  // Dashboard. Prefer the deployed env value; if missing, fall back to the
  // current origin so users on Vercel see a copy-pasteable URL out of the
  // box (the one Spotify will accept once redeployed).
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const proto = hdrs.get("x-forwarded-proto") || "https";
  const fallbackRedirect = host ? `${proto}://${host}/api/oauth/spotify/callback` : "";
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || fallbackRedirect || "http://127.0.0.1:3000/api/oauth/spotify/callback";
  const redirectValidation = process.env.SPOTIFY_REDIRECT_URI ? validateSpotifyRedirectUri() : { ok: true, error: null };
  const spotifyOAuth = {
    hasCredentials: hasSpotifyCredentials(),
    redirectUri,
    redirectUriValid: redirectValidation.ok,
    redirectUriError: redirectValidation.error,
    isConnected: Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock,
    serviceUsername: spotifyAccount?.serviceUsername,
    lastError: spotifyAccount?.lastError,
  };

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
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Spotify</h2>
          <SpotifyOAuthSetup {...spotifyOAuth} />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">
            Spotify (sp_dc cookie — fallback)
          </h2>
          <div className="panel-inset mb-3 p-3 text-xs text-muted-fg">
            <strong className="text-[#fcd34d]">Note:</strong> The cookie flow is blocked at Spotify&apos;s Varnish
            edge for Vercel and most datacenter IPs (response is{" "}
            <code className="rounded bg-[var(--surface)] px-1 py-0.5">403 URL Blocked, Error 54113</code>). Use it
            only if you&apos;re running the app from a residential IP / proxy. Otherwise stick with OAuth above.
          </div>
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
