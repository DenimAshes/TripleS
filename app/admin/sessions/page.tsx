import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ServiceConnectionCard } from "@/components/ServiceConnectionCard";
import { SessionUploader } from "@/components/SessionUploader";
import { SpotifyOAuthSetup } from "@/components/SpotifyOAuthSetup";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getSpotifyWebCookie } from "@/lib/services/spotify/spotifyCookieStore";
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
  const hasSpotifyCookie = Boolean(await getSpotifyWebCookie(session.userId));
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

  const spotifyConnected =
    Boolean(spotifyAccount) && spotifyAccount?.connectionStatus === "CONNECTED" && !spotifyAccount?.isMock;

  return (
    // The description and the link used to live in a panel below the title,
    // which restated the heading and added three brand pills that filtered
    // nothing. AppShell has slots for both.
    <AppShell
      title="Ops: session storage"
      description="Spotify uses login through OAuth. YouTube Music and SoundCloud use the saved browser session JSON that background workers read."
      actions={
        <Link href="/connections" className="btn btn-ghost">
          User setup <ArrowRight size={15} />
        </Link>
      }
    >
      <section className="grid items-stretch gap-4 xl:grid-cols-3">
        <ServiceConnectionCard
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
          <SessionUploader key={item.service} initial={item} />
        ))}
      </section>
    </AppShell>
  );
}
