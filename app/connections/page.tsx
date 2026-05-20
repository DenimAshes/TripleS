import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Clock3, KeyRound, RadioTower, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceIcon, ServicePill, serviceMeta } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";

const BROWSER_SERVICES = ["youtube", "soundcloud"];

function browserSessionStatus(exists: boolean, iso: string | null) {
  if (!exists || !iso) return { label: "Missing", tone: "muted" };
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days >= 14) return { label: "Stale", tone: "danger" };
  if (days >= 7) return { label: "Ageing", tone: "warning" };
  return { label: "Fresh", tone: "success" };
}

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
  const overviewItems = [
    {
      service: "SPOTIFY",
      title: "Login",
      subtitle: spotifyConnected ? spotifyAccount?.serviceUsername ?? "Connected" : hasSpotifyCredentials() ? "Ready to connect" : "Setup needed",
      status: spotifyConnected ? "Connected" : hasSpotifyCredentials() ? "Ready" : "Setup",
      tone: spotifyConnected ? "success" : "warning",
      icon: <KeyRound size={15} />,
      href: "#connection-spotify",
    },
    ...browserSessions.map((item) => {
      const sessionStatus = browserSessionStatus(item.exists, item.updatedAt);
      return {
        service: item.service,
        title: "Session",
        subtitle: item.exists ? "Saved browser JSON" : "Upload required",
        status: sessionStatus.label,
        tone: sessionStatus.tone,
        icon: item.exists ? <Clock3 size={15} /> : <UploadCloud size={15} />,
        href: `#connection-${item.service.toLowerCase()}`,
      };
    }),
  ];

  return (
    <AppShell title="Connections">
      <div className="space-y-8">
        <section className="relative overflow-hidden py-1">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-[var(--accent-soft)] blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap gap-2" aria-label="Supported services">
                <ServicePill service="SPOTIFY" />
                <ServicePill service="YOUTUBE" />
                <ServicePill service="SOUNDCLOUD" />
              </div>
              <h2 className="mt-5 max-w-2xl text-2xl font-black tracking-tight text-white md:text-4xl">
                One clean setup screen for every music connection.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-fg">
                Spotify is handled by secure login. YouTube Music and SoundCloud stay ready through a saved browser
                session JSON.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:items-center">
              <span className="pill pill-accent justify-center">
                <RadioTower size={13} />
                {connectedCount}/3 ready
              </span>
              <Link href="/playlists" className="btn btn-ghost whitespace-nowrap">
                Open playlists <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-2 border-y border-[var(--border-soft)] py-3 sm:grid-cols-3" aria-label="Connection status">
          {overviewItems.map((item) => (
            <ConnectionOverviewItem key={item.service} {...item} />
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <ServiceConnectionCard
            id="connection-spotify"
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
            <SessionUploader key={item.service} cardId={`connection-${item.service.toLowerCase()}`} initial={item} />
          ))}
        </section>
      </div>
    </AppShell>
  );
}

function ConnectionOverviewItem({
  service,
  title,
  subtitle,
  status,
  tone,
  icon,
  href,
}: {
  service: string;
  title: string;
  subtitle: string;
  status: string;
  tone: string;
  icon: ReactNode;
  href: string;
}) {
  const meta = serviceMeta(service);
  const pillClass =
    tone === "success" ? "pill-success" : tone === "warning" ? "pill-warning" : tone === "danger" ? "pill-danger" : "";

  return (
    <a
      href={href}
      aria-label={`Jump to ${meta.label} connection setup`}
      className="group flex min-w-0 items-center justify-between gap-3 rounded-xl px-2 py-2 transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--surface-2)] focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <ServiceIcon service={service} size="sm" className="transition duration-200 group-hover:scale-105" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-dim-fg">
            {icon}
            {title}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-white">{meta.label}</p>
          <p className="truncate text-xs text-muted-fg">{subtitle}</p>
        </div>
      </div>
      <span className={`pill shrink-0 ${pillClass}`}>{status}</span>
    </a>
  );
}

function ServiceConnectionCard({
  id,
  service,
  status,
  mode,
  icon,
  children,
}: {
  id: string;
  service: string;
  status: string;
  mode: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const meta = serviceMeta(service);
  const connected = status === "connected";

  return (
    <section
      id={id}
      className={`panel group relative flex min-h-[360px] scroll-mt-24 flex-col overflow-hidden p-5 transition duration-300 ${meta.border} hover:-translate-y-1 hover:shadow-[0_26px_60px_-44px_var(--accent-glow)] md:scroll-mt-8 xl:min-h-[420px]`}
    >
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
