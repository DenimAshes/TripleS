import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ServicePill } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyCookieConnector } from "@/components/SpotifyCookieConnector";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";

const BROWSER_SERVICES = ["youtube", "soundcloud"];

export default async function AdminSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, spotifyAccount, spotifyCookie] = await Promise.all([
    prisma.workerSessionState.findMany({
      where: { service: { in: BROWSER_SERVICES } },
    }),
    prisma.connectedAccount.findUnique({
      where: { userId_service: { userId: session.userId, service: "SPOTIFY" } },
    }),
    getSpotifyWebCookie(session.userId),
  ]);

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

  const byService = new Map(rows.map((row) => [row.service, row]));
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
    <AppShell title="Ops: session storage">
      <div className="space-y-6">
        <section className="panel p-5 text-sm text-muted-fg">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ServicePill service="SPOTIFY" />
            <ServicePill service="YOUTUBE" />
            <ServicePill service="SOUNDCLOUD" />
          </div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Admin storage tools</h2>
          <p className="mb-3 text-xs text-muted-fg">
            Normal account setup lives on{" "}
            <Link href="/connections" className="text-[var(--accent)] hover:underline">
              Connections
            </Link>
            . This page is for inspecting and replacing the raw browser-session data used by background workers.
          </p>
          <p className="mb-2 text-xs text-muted-fg">
            <strong className="text-[var(--text)]">Spotify</strong> should use OAuth. The{" "}
            <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs">sp_dc</code> cookie is only an
            advanced local fallback.
          </p>
          <p className="mb-3 text-xs text-muted-fg">
            <strong className="text-[var(--text)]">YouTube Music</strong> and{" "}
            <strong className="text-[var(--text)]">SoundCloud</strong> use a full Playwright storageState export from
            your logged-in browser.
          </p>
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>Log in to the service in your personal browser.</li>
            <li>
              Install the free{" "}
              <a className="text-[var(--accent)] hover:underline" href="https://cookie-editor.com/" target="_blank" rel="noreferrer">
                Cookie-Editor
              </a>{" "}
              extension.
            </li>
            <li>
              Open Cookie-Editor on the logged-in tab, choose <strong className="text-[var(--text)]">Export</strong>,
              then <strong className="text-[var(--text)]">Export as Playwright</strong> if available.
            </li>
            <li>Drop the downloaded JSON into the matching card below, or paste the JSON manually.</li>
          </ol>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Spotify OAuth</h2>
          <SpotifyOAuthSetup {...spotifyOAuth} />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Spotify sp_dc cookie fallback</h2>
          <div className="panel-inset mb-3 p-3 text-xs text-muted-fg">
            <strong className="text-[#fcd34d]">Note:</strong> Spotify blocks this cookie flow from Vercel and most
            datacenter IPs. Use OAuth unless you are running from a residential IP or proxy.
          </div>
          <SpotifyCookieConnector
            hasCookie={Boolean(spotifyCookie)}
            serviceUsername={spotifyAccount?.serviceUsername}
            connectionStatus={spotifyAccount?.connectionStatus}
            lastError={spotifyAccount?.lastError}
          />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim-fg">Browser sessions</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {browserSessions.map((item) => (
              <SessionUploader key={item.service} initial={item} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
