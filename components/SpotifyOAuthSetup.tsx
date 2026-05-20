import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2 } from "lucide-react";

type Props = {
  hasCredentials: boolean;
  redirectUri: string;
  redirectUriValid: boolean;
  redirectUriError: string | null;
  isConnected: boolean;
  serviceUsername?: string | null;
  lastError?: string | null;
};

export function SpotifyOAuthSetup({
  hasCredentials,
  redirectUri,
  redirectUriValid,
  redirectUriError,
  isConnected,
  serviceUsername,
  lastError,
}: Props) {
  return (
    <section className="panel space-y-4 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-2)] text-emerald-400">
            <Link2 size={16} />
          </div>
          <div>
            <h2 className="text-base font-semibold">Spotify account connection</h2>
            <p className="text-xs text-muted-fg">
              Opens Spotify, asks for permission, and comes back here. This is the best option for Vercel and other
              cloud hosts.
            </p>
          </div>
        </div>
        {isConnected ? <span className="pill pill-success">connected</span> : null}
      </header>

      {isConnected && serviceUsername ? (
        <div className="panel-inset flex items-center gap-2 p-3 text-sm">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="text-muted-fg">
            Connected as <strong className="text-[var(--text)]">{serviceUsername}</strong>. Playlists will refresh on
            schedule.
          </span>
        </div>
      ) : null}

      {lastError ? (
        <div className="panel-inset flex items-start gap-2 p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#fca5a5]" />
          <span className="text-[#fca5a5]">{lastError}</span>
        </div>
      ) : null}

      {hasCredentials ? (
        <div className="space-y-3">
          {!redirectUriValid ? (
            <div className="panel-inset flex items-start gap-2 p-3 text-sm text-[#fcd34d]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{redirectUriError}</span>
            </div>
          ) : null}
          <form method="post" action="/api/oauth/spotify/start">
            <button type="submit" className="btn btn-primary">
              <Link2 size={16} />
              {isConnected ? "Re-connect Spotify" : "Connect Spotify"}
            </button>
          </form>
          <p className="text-xs text-dim-fg">Spotify will ask for playlist access, then return to this app.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-muted-fg">
          <p className="text-[#fcd34d]">
            <strong className="font-semibold">Setup required.</strong> One-time, free, about 5 minutes.
          </p>
          <ol className="ml-5 list-decimal space-y-2.5">
            <li>
              Go to{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
              >
                developer.spotify.com/dashboard
                <ExternalLink size={12} />
              </a>{" "}
              and sign in with your regular Spotify account.
            </li>
            <li>
              Click <strong className="text-[var(--text)]">Create app</strong>. Name and description can be anything.{" "}
              <strong className="text-[var(--text)]">Redirect URI</strong>: paste this exactly:
              <code className="mt-1.5 block break-all rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)]">
                {redirectUri}
              </code>
              Check <strong className="text-[var(--text)]">Web API</strong> as the API used.
            </li>
            <li>
              On the created app page, open <strong className="text-[var(--text)]">Settings</strong>. Copy the{" "}
              <strong className="text-[var(--text)]">Client ID</strong> and reveal +{" "}
              <strong className="text-[var(--text)]">Client secret</strong>.
            </li>
            <li>
              In your Vercel project, open <strong className="text-[var(--text)]">Settings / Environment Variables</strong>,
              add three vars:
              <ul className="ml-5 mt-1.5 list-disc space-y-1 text-xs">
                <li>
                  <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">SPOTIFY_CLIENT_ID</code>: paste the
                  Client ID
                </li>
                <li>
                  <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">SPOTIFY_CLIENT_SECRET</code>: paste
                  the Client Secret
                </li>
                <li>
                  <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">SPOTIFY_REDIRECT_URI</code>: paste{" "}
                  <code className="break-all">{redirectUri}</code>
                </li>
              </ul>
            </li>
            <li>
              Redeploy. Come back to this page and click{" "}
              <strong className="text-[var(--text)]">Connect Spotify</strong>.
            </li>
          </ol>
          <p className="text-xs text-dim-fg">
            OAuth tokens auto-refresh, so unlike sp_dc cookies you won&apos;t need to repaste anything. Manage playlists
            from{" "}
            <Link href="/playlists" className="text-[var(--accent)] hover:underline">
              your playlists page
            </Link>
            .
          </p>
        </div>
      )}
    </section>
  );
}
