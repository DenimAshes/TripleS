import { Music2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { ConnectServiceButton } from "./ConnectServiceButton";

function statusFor({
  username,
  isMock,
  connectionStatus,
}: {
  username?: string;
  isMock?: boolean;
  connectionStatus?: string;
}) {
  if (connectionStatus === "NEEDS_LOGIN") return "needs_login";
  if (connectionStatus === "LIMITED") return "limited";
  if (connectionStatus === "ERROR") return "error";
  if (isMock || connectionStatus === "MOCK") return "mock";
  if (username) return "connected";
  return "not_connected";
}

function serviceLabel(name: string) {
  const labels: Record<string, string> = {
    SPOTIFY: "Spotify",
    YOUTUBE: "YouTube Music",
    SOUNDCLOUD: "SoundCloud",
  };
  return labels[name] || name;
}

function serviceTint(name: string): string {
  const tints: Record<string, string> = {
    SPOTIFY: "from-emerald-500/25 to-emerald-500/0",
    YOUTUBE: "from-rose-500/25 to-rose-500/0",
    SOUNDCLOUD: "from-orange-500/25 to-orange-500/0",
  };
  return tints[name] || "from-[var(--accent)]/25 to-[var(--accent)]/0";
}

export function ServiceCard({
  name,
  username,
  isMock,
  connectionStatus,
  lastError,
}: {
  name: string;
  username?: string;
  isMock?: boolean;
  connectionStatus?: string;
  lastError?: string | null;
}) {
  const status = statusFor({ username, isMock, connectionStatus });
  const statusMessage =
    status === "needs_login"
      ? "Session expired — re-login required."
      : status === "limited"
      ? "Some account features are unavailable."
      : null;
  return (
    <div className="panel relative min-w-0 overflow-hidden p-5">
      {/* Soft service-themed glow in the top corner — keeps cards visually
          distinguishable from each other at a glance without leaning on
          loud brand colors. */}
      <div className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${serviceTint(name)} blur-3xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] text-[var(--text)]">
            <Music2 size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold">{serviceLabel(name)}</div>
            <div className="truncate text-sm text-muted-fg">{username || "Connect your account"}</div>
            {statusMessage ? (
              <div className="mt-1 text-xs text-[#fcd34d]" title={lastError || undefined}>
                {statusMessage}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={status} />
          {name === "SPOTIFY" ? <ConnectServiceButton service="spotify" /> : null}
        </div>
      </div>
    </div>
  );
}
