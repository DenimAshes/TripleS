import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceIcon, ServicePill } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyCookieConnector } from "@/components/SpotifyCookieConnector";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";

const BROWSER_SERVICES = ["youtube", "soundcloud"];

export default async function ConnectionsPage() {
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

  const spotifyConnected = Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock;
  const connectedCount = Number(spotifyConnected) + browserSessions.filter((item) => item.exists).length;

  return (
    <AppShell title="Connections">
      <div className="space-y-8">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-3">
              <ServicePill service="SPOTIFY" />
              <ServicePill service="YOUTUBE" />
              <ServicePill service="SOUNDCLOUD" />
            </div>
            <h2 className="mt-5 text-2xl font-black tracking-tight text-white">Connect the music accounts you want TripleS to sync.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-fg">
              Spotify uses OAuth and redirects you to Spotify. YouTube Music and SoundCloud use an exported browser
              session JSON, because those services are controlled through browser automation.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-fg">
              <span className="pill pill-success">{connectedCount}/3 connected</span>
              <span className="pill">OAuth + browser sessions</span>
              <span className="pill">Playlist refresh after connect</span>
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
                <ShieldCheck size={21} />
              </div>
              <div>
                <h3 className="font-bold text-white">Recommended order</h3>
                <p className="text-sm text-muted-fg">Connect Spotify first, then import YouTube Music and SoundCloud sessions.</p>
              </div>
            </div>
            <Link href="/playlists" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
              Go to playlists after connecting <ArrowRight size={15} />
            </Link>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-1">
            <PlatformIntro service="SPOTIFY" title="Spotify" body="Best cloud path. Click connect, authorize in Spotify, and playlists import automatically." />
          </div>
          <div className="xl:col-span-2">
            <SpotifyOAuthSetup
              hasCredentials={hasSpotifyCredentials()}
              redirectUri={redirectUri}
              redirectUriValid={redirectValidation.ok}
              redirectUriError={redirectValidation.error}
              isConnected={spotifyConnected}
              serviceUsername={spotifyAccount?.serviceUsername}
              lastError={spotifyAccount?.lastError}
            />
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <PlatformIntro
            service="YOUTUBE"
            title="YouTube Music"
            body="Export your logged-in browser storageState JSON, then drop the file here or paste the JSON."
          />
          <PlatformIntro
            service="SOUNDCLOUD"
            title="SoundCloud"
            body="Uses the same import flow as YouTube Music: file drop, file picker, or direct JSON paste."
          />
          <div className="panel p-5 text-sm text-muted-fg">
            <h3 className="font-bold text-white">How to export JSON</h3>
            <ol className="mt-3 space-y-2 text-xs leading-5">
              <li>1. Log in to the service in your normal browser.</li>
              <li>2. Open Cookie-Editor on that tab.</li>
              <li>3. Choose Export as Playwright, or export JSON cookies.</li>
              <li>4. Drop the JSON file into the matching card below.</li>
            </ol>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {browserSessions.map((item) => (
            <SessionUploader key={item.service} initial={item} />
          ))}
        </section>

        <details className="panel p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white">Advanced Spotify cookie fallback</summary>
          <p className="mt-3 text-sm text-muted-fg">
            Use this only when OAuth is not possible. Cloud hosts often get blocked by Spotify for this cookie flow.
          </p>
          <div className="mt-4">
            <SpotifyCookieConnector
              hasCookie={Boolean(spotifyCookie)}
              serviceUsername={spotifyAccount?.serviceUsername}
              connectionStatus={spotifyAccount?.connectionStatus}
              lastError={spotifyAccount?.lastError}
            />
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function PlatformIntro({ service, title, body }: { service: string; title: string; body: string }) {
  return (
    <div className="panel h-full p-5">
      <div className="flex items-start gap-4">
        <ServiceIcon service={service} size="lg" />
        <div>
          <h3 className="text-lg font-black tracking-tight text-white">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-fg">{body}</p>
        </div>
      </div>
    </div>
  );
}
