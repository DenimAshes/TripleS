import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, ListMusic } from "lucide-react";
import { Callout } from "./Callout";
import { SpotifyCookieLogin } from "./SpotifyCookieLogin";

type Props = {
  hasCredentials: boolean;
  redirectUri: string;
  redirectUriValid: boolean;
  redirectUriError: string | null;
  isConnected: boolean;
  serviceUsername?: string | null;
  lastError?: string | null;
  hasCookie: boolean;
};

export function SpotifyOAuthSetup({
  hasCredentials,
  redirectUri,
  redirectUriValid,
  redirectUriError,
  isConnected,
  serviceUsername,
  lastError,
  hasCookie,
}: Props) {
  if (hasCredentials) {
    return (
      <div className="flex flex-1 flex-col">
        <p className="text-sm leading-6 text-muted-fg">
          Sign in with Spotify, approve playlist access, and TripleS will keep the token refreshed automatically.
        </p>

        {isConnected ? (
          <Callout tone="success" className="mt-4" icon={<CheckCircle2 size={16} className="mt-0.5 shrink-0" />}>
            Connected{serviceUsername ? <> as <strong className="font-semibold">{serviceUsername}</strong></> : null}
          </Callout>
        ) : null}

        {lastError ? (
          <Callout tone="danger" className="mt-3">
            {lastError}
          </Callout>
        ) : null}

        {!redirectUriValid ? (
          <Callout tone="warning" className="mt-3">
            {redirectUriError}
          </Callout>
        ) : null}

        <div className="mt-auto grid gap-2 pt-6">
          <form method="post" action="/api/oauth/spotify/start">
            <button type="submit" className="btn btn-primary w-full">
              <Link2 size={16} />
              {isConnected ? "Reconnect Spotify" : "Login with Spotify"}
            </button>
          </form>
          {isConnected ? (
            <Link href="/playlists?service=SPOTIFY" className="btn btn-ghost w-full">
              <ListMusic size={16} />
              View Spotify playlists
            </Link>
          ) : null}
          <SpotifyCookieLogin hasCookie={hasCookie} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <Callout tone="warning" icon={<AlertTriangle size={16} className="mt-0.5 shrink-0" />}>
        Spotify OAuth is not configured yet.
      </Callout>
      <p className="mt-4 text-sm leading-6 text-muted-fg">
        Add Spotify app credentials once, redeploy, then this card becomes a simple login button.
      </p>
      <div className="mt-4 space-y-2 text-xs text-muted-fg">
        <a
          href="https://developer.spotify.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[var(--accent)] transition hover:text-[var(--accent-hover)]"
        >
          Spotify Developer Dashboard <ExternalLink size={12} />
        </a>
        <code className="block break-all rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)]">
          {redirectUri}
        </code>
      </div>
      <SpotifyCookieLogin hasCookie={hasCookie} />
      <Link href="/settings" className="btn btn-ghost mt-auto w-full">
        Open settings
      </Link>
    </div>
  );
}
