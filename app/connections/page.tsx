import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, KeyRound, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceConnectionCard } from "@/components/ServiceConnectionCard";
import { serviceMeta } from "@/components/ServiceBrand";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { hasSpotifyCredentials, validateSpotifyRedirectUri } from "@/lib/services/spotify/spotifyAuth";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
import {
  hasUsableStoredSession,
  type SessionService,
} from "@/lib/services/workerSessionState";

const BROWSER_SERVICES = ["youtube", "soundcloud"] as const satisfies readonly SessionService[];

function browserSessionStatus(exists: boolean, isUsable: boolean) {
  if (!exists) return { label: "Missing", tone: "muted" };
  return isUsable ? { label: "Ready", tone: "success" } : { label: "Invalid", tone: "danger" };
}

function browserRoute(service: string): string {
  return service.toLowerCase() === "soundcloud" ? "/soundcloud-browser" : "/youtube-browser";
}

export default async function ConnectionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, spotifyAccount] = await Promise.all([
    prisma.workerSessionState.findMany({
      where: { service: { in: [...BROWSER_SERVICES] } },
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
      isUsable: hasUsableStoredSession(service, row?.stateGzipBase64),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });

  const hasSpotifyCookie = session ? Boolean(await getSpotifyWebCookie(session.userId)) : false;
  const spotifyConnected = Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock;
  const spotifyCredentialsReady = hasSpotifyCredentials();
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
      const sessionStatus = browserSessionStatus(item.exists, item.isUsable);
      const ready = sessionStatus.tone === "success";
      const needsUpload = !item.exists;
      const meta = serviceMeta(item.service);
      return {
        service: item.service,
        title: ready ? `${meta.label} session is ready` : needsUpload ? `Upload ${meta.label} session` : `Replace invalid ${meta.label} session`,
        detail: ready ? "Authentication cookies are present and unexpired." : needsUpload ? "Upload a JSON export from the logged-in browser." : "The saved state has no usable authentication cookies.",
        status: sessionStatus.label,
        tone: sessionStatus.tone,
        href: ready ? browserRoute(item.service) : `#connection-${item.service.toLowerCase()}`,
        action: ready ? "Browse playlists" : "Fix session",
        icon: item.exists ? <Clock3 size={16} /> : <UploadCloud size={16} />,
      };
    }),
  ];

  const nextTask = setupTasks.find((task) => task.tone !== "success") ?? null;
  const readyCount = setupTasks.filter((task) => task.tone === "success").length;

  return (
    <AppShell
      title="Connections"
      description="Spotify signs in with OAuth. YouTube Music and SoundCloud work through a saved browser session."
    >
      <section className="workbench overflow-hidden" aria-labelledby="connection-progress-heading">
        <div className="workbench-header">
          <div>
            <div className="eyebrow text-muted-fg">Setup progress</div>
            <h2 id="connection-progress-heading" className="heading-card mt-1">{readyCount} of 3 platforms ready</h2>
          </div>
          <span className={`pill ${readyCount === 3 ? "pill-success" : "pill-warning"}`}>{readyCount === 3 ? "Ready to sync" : `${3 - readyCount} remaining`}</span>
        </div>
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex gap-2" aria-label={`${readyCount} of 3 platforms ready`}>
            {setupTasks.map((task) => (
              <div key={task.service} className="min-w-0 flex-1">
                <div className={`h-1.5 rounded-full ${task.tone === "success" ? "bg-success" : "bg-warning"}`} />
                <div className="mt-2 truncate text-xs text-muted-fg">{serviceMeta(task.service).shortLabel}: {task.status}</div>
              </div>
            ))}
          </div>
          {nextTask ? (
            <Link href={nextTask.href} className="btn btn-primary">
              {nextTask.icon}
              {nextTask.action}
            </Link>
          ) : (
            <Link href="/playlists" className="btn btn-primary">Open playlists</Link>
          )}
        </div>
        {nextTask ? (
          <div className="border-t border-line-soft px-4 py-3 sm:px-5">
            <p className="text-sm font-semibold text-[var(--text)]">Next: {nextTask.title}</p>
            <p className="mt-0.5 text-xs text-muted-fg">{nextTask.detail}</p>
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="heading-section">Platform access</h2>
            <p className="mt-1 text-xs text-muted-fg">Each row explains what TripleS uses and keeps advanced controls close to that platform.</p>
          </div>
        </div>
        <div className="grid gap-4">
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
        </div>
      </section>
    </AppShell>
  );
}
