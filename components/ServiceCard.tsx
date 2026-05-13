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
  const limitedMessage = status === "limited" ? "Some account features are unavailable." : null;
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#18181b] text-white">
            <Music2 size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-medium">{serviceLabel(name)}</div>
            <div className="truncate text-sm text-[#666a73]">{username || "Connect your account"}</div>
            {limitedMessage ? (
              <div className="mt-1 text-xs text-orange-700" title={lastError || undefined}>
                {limitedMessage}
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
