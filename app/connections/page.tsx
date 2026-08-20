import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, KeyRound, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Callout } from "@/components/Callout";
import { ServiceConnectionCard } from "@/components/ServiceConnectionCard";
import { ServiceIcon, serviceMeta } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";

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

  const hasSpotifyCookie = session ? Boolean(await getSpotifyWebCookie(session.userId)) : false;
  const spotifyConnected = Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock;
  const spotifyCredentialsReady = hasSpotifyCredentials();
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
  // The one thing worth doing next, instead of a panel restating all three.
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

  const nextTask = setupTasks.find((task) => task.tone !== "success") ?? null;

  return (
    <AppShell
      title="Connections"
      description="Spotify signs in with OAuth. YouTube Music and SoundCloud work through a saved browser session."
      actions={
        <Link href="/playlists" className="btn btn-ghost">
          Open playlists
        </Link>
      }
    >
      <div className="space-y-5">
        {/* One status summary, then the cards that act on it. This screen used to
            state "three services are fine" five times over: brand chips, a
            progress bar, this strip, a setup assistant and the cards. */}
        <section className="grid gap-1 border-y border-[var(--border-soft)] py-2 lg:grid-cols-3" aria-label="Connection status">
          {overviewItems.map((item) => (
            <ConnectionOverviewItem key={item.service} {...item} />
          ))}
        </section>

        {nextTask ? (
          <Callout
            tone={nextTask.tone === "danger" ? "danger" : "warning"}
            title={nextTask.title}
            action={
              <Link href={nextTask.href} className="btn btn-ghost">
                {nextTask.action}
              </Link>
            }
          >
            {nextTask.detail}
          </Callout>
        ) : null}

        <section className="grid items-stretch gap-4 xl:grid-cols-3">
          <ServiceConnectionCard
            id="connection-spotify"
            service="SPOTIFY"
            status={spotifyConnected ? "Connected" : hasSpotifyCredentials() ? "Ready" : "Setup needed"}
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
              hasCookie={hasSpotifyCookie}
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
  href,
}: {
  service: string;
  title: string;
  subtitle: string;
  status: string;
  tone: string;
  href: string;
}) {
  const meta = serviceMeta(service);
  const pillClass =
    tone === "success" ? "pill-success" : tone === "warning" ? "pill-warning" : tone === "danger" ? "pill-danger" : "";

  return (
    <a
      href={href}
      aria-label={`Jump to ${meta.label} connection setup`}
      className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors hover:bg-surface-2"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ServiceIcon service={service} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text)]">{meta.label}</p>
          <p className="truncate text-xs text-muted-fg">
            {title} · {subtitle}
          </p>
        </div>
      </div>
      <span className={`pill shrink-0 ${pillClass}`}>{status}</span>
    </a>
  );
}

