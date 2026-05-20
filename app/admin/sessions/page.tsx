import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServicePill } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";

const BROWSER_SERVICES = ["youtube", "soundcloud"];

export default async function AdminSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, spotifyAccount] = await Promise.all([
    prisma.workerSessionState.findMany({
      where: { service: { in: BROWSER_SERVICES } },
    }),
    prisma.connectedAccount.findUnique({
      where: { userId_service: { userId: session.userId, service: "SPOTIFY" } },
    }),
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

  return (
    <AppShell title="Ops: session storage">
      <div className="space-y-7">
        <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border-soft)] bg-[linear-gradient(135deg,rgba(17,19,26,0.92),rgba(23,26,35,0.66))] p-5 md:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <ServicePill service="SPOTIFY" />
              <ServicePill service="YOUTUBE" />
              <ServicePill service="SOUNDCLOUD" />
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-white">Account access</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-fg">
              Spotify uses login through OAuth. YouTube Music and SoundCloud use the saved browser session JSON that
              background workers read.
            </p>
          </div>
          <Link href="/connections" className="btn btn-ghost">
            User setup <ArrowRight size={15} />
          </Link>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="panel flex min-h-[420px] flex-col p-5">
            <h3 className="text-xl font-black tracking-tight text-white">Spotify</h3>
            <p className="mt-2 text-sm text-muted-fg">OAuth only. Use the Spotify login flow to connect this account.</p>
            <div className="mt-5 flex flex-1 flex-col">
              <SpotifyOAuthSetup
                hasCredentials={hasSpotifyCredentials()}
                redirectUri={redirectUri}
                redirectUriValid={redirectValidation.ok}
                redirectUriError={redirectValidation.error}
                isConnected={Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock}
                serviceUsername={spotifyAccount?.serviceUsername}
                lastError={spotifyAccount?.lastError}
              />
            </div>
          </div>

          {browserSessions.map((item) => (
            <SessionUploader key={item.service} initial={item} />
          ))}
        </section>
      </div>
    </AppShell>
  );
}
