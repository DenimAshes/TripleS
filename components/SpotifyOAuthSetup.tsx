import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, ListMusic } from "lucide-react";

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
  if (hasCredentials) {
    return (
      <div className="flex flex-1 flex-col">
        <p className="text-sm leading-6 text-muted-fg">
          Sign in with Spotify, approve playlist access, and TripleS will keep the token refreshed automatically.
        </p>

        {isConnected ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
            <span>
              Connected{serviceUsername ? <> as <strong className="font-semibold text-white">{serviceUsername}</strong></> : null}
            </span>
          </div>
        ) : null}

        {lastError ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-[#fca5a5]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{lastError}</span>
          </div>
        ) : null}

        {!redirectUriValid ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-[#fcd34d]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{redirectUriError}</span>
          </div>
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-[#fcd34d]">
        Spotify OAuth is not configured yet.
      </div>
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
        <code className="block break-all rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--text)]">
          {redirectUri}
        </code>
      </div>
      <Link href="/settings" className="btn btn-ghost mt-auto w-full">
        Open settings
      </Link>
    </div>
  );
}
