import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, KeyRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceIcon, ServicePill, serviceMeta } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";

const BROWSER_SERVICES = ["youtube", "soundcloud"];

export default async function ConnectionsPage() {
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

  const spotifyConnected = Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock;
  const connectedCount = Number(spotifyConnected) + browserSessions.filter((item) => item.exists).length;

  return (
    <AppShell title="Connections">
      <div className="space-y-7">
        <section className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[linear-gradient(135deg,rgba(17,19,26,0.92),rgba(23,26,35,0.66))] p-5 shadow-[0_22px_70px_-52px_rgba(79,141,255,0.75)] md:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap gap-2">
                <ServicePill service="SPOTIFY" />
                <ServicePill service="YOUTUBE" />
                <ServicePill service="SOUNDCLOUD" />
              </div>
              <h2 className="mt-5 text-2xl font-black tracking-tight text-white md:text-3xl">
                Connect your music services once. Keep the sync worker ready.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-fg">
                Spotify signs in through OAuth. YouTube Music and SoundCloud use a browser session JSON from the
                logged-in account.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
              <span className="pill pill-success justify-center">{connectedCount}/3 connected</span>
              <Link href="/playlists" className="btn btn-ghost">
                Playlists <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <ServiceConnectionCard
            service="SPOTIFY"
            status={spotifyConnected ? "connected" : hasSpotifyCredentials() ? "ready" : "setup needed"}
            mode="OAuth login"
            icon={<KeyRound size={18} />}
          >
            <SpotifyOAuthSetup
              hasCredentials={hasSpotifyCredentials()}
              redirectUri={redirectUri}
              redirectUriValid={redirectValidation.ok}
              redirectUriError={redirectValidation.error}
              isConnected={spotifyConnected}
              serviceUsername={spotifyAccount?.serviceUsername}
              lastError={spotifyAccount?.lastError}
            />
          </ServiceConnectionCard>

          {browserSessions.map((item) => (
            <SessionUploader key={item.service} initial={item} />
          ))}
        </section>
      </div>
    </AppShell>
  );
}

function ServiceConnectionCard({
  service,
  status,
  mode,
  icon,
  children,
}: {
  service: string;
  status: string;
  mode: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = serviceMeta(service);
  const connected = status === "connected";

  return (
    <section className="panel group relative flex min-h-[420px] flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--border-accent)] hover:shadow-[0_26px_60px_-44px_var(--accent-glow)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-0 transition duration-300 group-hover:opacity-80" />
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ServiceIcon service={service} size="lg" className="transition duration-300 group-hover:scale-105" />
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black tracking-tight text-white">{meta.label}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-dim-fg">
              {icon}
              {mode}
            </p>
          </div>
        </div>
        <span className={`pill ${connected ? "pill-success" : "pill-warning"}`}>
          {connected ? <CheckCircle2 size={13} /> : null}
          {status}
        </span>
      </header>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </section>
  );
}
