import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, KeyRound, ListChecks, RadioTower, UploadCloud } from "lucide-react";
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

function browserRoute(service: string): string {
  return service.toLowerCase() === "soundcloud" ? "/soundcloud-browser" : "/youtube-browser";
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
  const spotifyCredentialsReady = hasSpotifyCredentials();
  const connectedCount = Number(spotifyConnected) + browserSessions.filter((item) => item.exists).length;
  const healthyCount =
    Number(spotifyConnected) + browserSessions.filter((item) => browserSessionStatus(item.exists, item.updatedAt).tone === "success").length;
  const overviewItems = [
    {
      service: "SPOTIFY",
      title: "Login",
      subtitle: spotifyConnected ? spotifyAccount?.serviceUsername ?? "Connected" : spotifyCredentialsReady ? "Ready to connect" : "Setup needed",
      status: spotifyConnected ? "Connected" : spotifyCredentialsReady ? "Ready" : "Setup",
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
  const setupTasks = [
    {
      service: "SPOTIFY",
      title: spotifyConnected ? "Spotify login is connected" : spotifyCredentialsReady ? "Finish Spotify login" : "Configure Spotify login",
      detail: spotifyConnected
        ? spotifyAccount?.serviceUsername ?? "OAuth token is ready."
        : spotifyCredentialsReady
          ? "Sign in once to unlock Spotify playlist sync."
          : "Add app credentials before Spotify can connect.",
      status: spotifyConnected ? "Ready" : spotifyCredentialsReady ? "Action needed" : "Blocked",
      tone: spotifyConnected ? "success" : "warning",
      href: spotifyConnected ? "/playlists?service=SPOTIFY" : spotifyCredentialsReady ? "#connection-spotify" : "/settings",
      action: spotifyConnected ? "View playlists" : spotifyCredentialsReady ? "Login" : "Open settings",
      icon: <KeyRound size={16} />,
    },
    ...browserSessions.map((item) => {
      const sessionStatus = browserSessionStatus(item.exists, item.updatedAt);
      const ready = sessionStatus.tone === "success";
      const needsUpload = !item.exists;
      const meta = serviceMeta(item.service);
      return {
        service: item.service,
        title: ready ? `${meta.label} session is fresh` : needsUpload ? `Upload ${meta.label} session` : `Refresh ${meta.label} session`,
        detail: ready ? "Browser automation can read playlists." : needsUpload ? "Upload a JSON export from the logged-in browser." : "The saved session is old enough to refresh soon.",
        status: sessionStatus.label,
        tone: sessionStatus.tone,
        href: ready ? browserRoute(item.service) : `#connection-${item.service.toLowerCase()}`,
        action: ready ? "Browse playlists" : "Upload JSON",
        icon: item.exists ? <Clock3 size={16} /> : <UploadCloud size={16} />,
      };
    }),
  ];

  return (
    <AppShell title="Connections">
      <div className="space-y-8">
        <section className="relative overflow-hidden py-1 animate-slide-in-up">
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
              <ServiceActivityStrip connectedCount={connectedCount} healthyCount={healthyCount} />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:items-center">
              <span className="pill pill-accent surface-lift justify-center">
                <RadioTower size={13} />
                {connectedCount}/3 connected
              </span>
              <Link href="/playlists" className="btn btn-ghost surface-lift group whitespace-nowrap">
                Open playlists <ArrowRight size={15} className="transition duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </section>

        <section
          className="animated-sheen z-20 grid gap-2 border-y border-[var(--border-soft)] bg-[rgba(10,11,16,0.72)] py-3 backdrop-blur-xl animate-slide-in-up lg:grid-cols-3 lg:sticky lg:top-3"
          aria-label="Connection status"
          style={{ animationDelay: "60ms" }}
        >
          {overviewItems.map((item) => (
            <ConnectionOverviewItem key={item.service} {...item} />
          ))}
        </section>

        <SetupAssistant healthyCount={healthyCount} tasks={setupTasks} />

        <section className="grid gap-4 animate-slide-in-up lg:grid-cols-2 min-[1350px]:grid-cols-3" style={{ animationDelay: "140ms" }}>
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

function ServiceActivityStrip({ connectedCount, healthyCount }: { connectedCount: number; healthyCount: number }) {
  return (
    <div className="mt-6 max-w-2xl" aria-label="Connection activity">
      <div className="connection-activity-track">
        <span className="connection-activity-segment bg-[#1ed760]" style={{ animationDelay: "0ms" }} />
        <span className="connection-activity-segment bg-[#ff0033]" style={{ animationDelay: "900ms" }} />
        <span className="connection-activity-segment bg-[#ff7700]" style={{ animationDelay: "1800ms" }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim-fg">
        <span>{connectedCount}/3 connected</span>
        <span className="text-[var(--border)]">/</span>
        <span>{healthyCount}/3 healthy</span>
      </div>
    </div>
  );
}

function SetupAssistant({
  healthyCount,
  tasks,
}: {
  healthyCount: number;
  tasks: Array<{
    service: string;
    title: string;
    detail: string;
    status: string;
    tone: string;
    href: string;
    action: string;
    icon: ReactNode;
  }>;
}) {
  const percent = Math.round((healthyCount / 3) * 100);
  const nextTask = tasks.find((task) => task.tone !== "success") ?? tasks[0];

  return (
    <section
      className="panel group surface-lift animated-gradient-frame animated-sheen relative overflow-hidden p-5 animate-slide-in-up md:p-6"
      aria-label="Connection setup assistant"
      style={{ animationDelay: "100ms" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_at_15%_0%,rgba(79,141,255,0.08),transparent_52%)] opacity-60 transition duration-500 group-hover:opacity-100" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.45fr)] lg:items-start">
        <div className="relative min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">
            <ListChecks size={15} />
            Setup assistant
          </div>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-white">{healthyCount} of 3 services healthy</h3>
          <p className="mt-2 text-sm leading-6 text-muted-fg">
            Refresh ageing sessions before sync runs and use connected services to inspect playlists.
          </p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-hover),var(--success),var(--accent))] bg-[length:220%_100%] shadow-[0_0_18px_var(--accent-glow)] transition-[width] duration-700 animate-gradient-pan"
              style={{ width: `${percent}%` }}
            />
          </div>
          <Link href={nextTask.href} className="btn btn-primary surface-lift group mt-5 w-full sm:w-auto">
            {nextTask.action}
            <ArrowRight size={15} className="transition duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="relative grid gap-2">
          {tasks.map((task) => (
            <SetupTaskRow key={task.service} {...task} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SetupTaskRow({
  service,
  title,
  detail,
  status,
  tone,
  href,
  action,
  icon,
}: {
  service: string;
  title: string;
  detail: string;
  status: string;
  tone: string;
  href: string;
  action: string;
  icon: ReactNode;
}) {
  const meta = serviceMeta(service);
  const pillClass =
    tone === "success" ? "pill-success" : tone === "warning" ? "pill-warning" : tone === "danger" ? "pill-danger" : "";

  return (
    <a
      href={href}
      className="group surface-lift animated-sheen relative grid gap-3 overflow-hidden rounded-xl border border-transparent px-2 py-3 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)] hover:shadow-[0_18px_36px_-30px_var(--accent-glow)] focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
      aria-label={`${action}: ${meta.label}`}
    >
      <span className={`pointer-events-none absolute inset-y-3 left-0 w-1 rounded-full opacity-0 transition duration-300 group-hover:opacity-100 ${meta.bg}`} />
      <div className="flex min-w-0 gap-3">
        <ServiceIcon service={service} size="sm" className="mt-0.5 transition duration-200 group-hover:scale-105" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-dim-fg">
            {icon}
            {meta.label}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm leading-5 text-muted-fg">{detail}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pl-10 xl:justify-end xl:pl-0">
        <span className={`pill shrink-0 ${pillClass}`}>{tone === "danger" ? <AlertTriangle size={13} /> : null}{status}</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] transition group-hover:text-[var(--accent-hover)]">
          {action}
          <ArrowRight size={13} className="transition duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </a>
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
      className="group surface-lift animated-sheen relative flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl px-2 py-2 hover:bg-[var(--surface-2)] hover:shadow-[0_14px_30px_-28px_var(--accent-glow)] focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]"
    >
      <span className={`pointer-events-none absolute inset-x-3 bottom-0 h-px opacity-0 transition duration-300 group-hover:opacity-80 ${meta.bg}`} />
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
  const glowClass =
    meta.key === "SPOTIFY"
      ? "service-glow-spotify"
      : meta.key === "YOUTUBE"
        ? "service-glow-youtube"
        : meta.key === "SOUNDCLOUD"
          ? "service-glow-soundcloud"
          : "";

  return (
    <section
      id={id}
      className={`panel group surface-lift animated-gradient-frame animated-sheen ${glowClass} relative flex min-h-[360px] scroll-mt-24 flex-col overflow-hidden p-5 ${meta.border} hover:shadow-[0_28px_70px_-46px_var(--accent-glow)] md:scroll-mt-8 xl:min-h-[420px]`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-0 transition duration-300 group-hover:opacity-80" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_at_20%_0%,rgba(255,255,255,0.045),transparent_55%)] opacity-0 transition duration-500 group-hover:opacity-100" />
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
