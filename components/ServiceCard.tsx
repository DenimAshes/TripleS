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
    SPOTIFY: "from-emerald-500/20 to-transparent",
    YOUTUBE: "from-rose-500/20 to-transparent",
    SOUNDCLOUD: "from-orange-500/20 to-transparent",
  };
  return tints[name] || "from-blue-500/20 to-transparent";
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
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/5 bg-[#0d0e12]/60 p-6 backdrop-blur-xl transition-all hover:border-white/10 hover:bg-[#0d0e12]/80 group">
      {/* Анимированный градиент на фоне */}
      <div className={`pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-gradient-to-br ${serviceTint(name)} blur-[60px] opacity-50 transition-opacity group-hover:opacity-100 animate-pulse`} />
      
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/5 text-blue-400 border border-white/5 shadow-inner">
            <Music2 size={20} strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold tracking-tight text-white">{serviceLabel(name)}</div>
            <div className="mt-0.5 truncate text-xs font-medium text-slate-500">{username || "Not linked"}</div>
            {statusMessage ? (
              <div className="mt-1.5 text-xs text-[#fcd34d]" title={lastError || undefined}>
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
