import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

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
  const meta = serviceMeta(name);
  const statusMessage =
    status === "needs_login"
      ? "Session expired. Reconnect this platform."
      : status === "limited"
        ? "Some account features are unavailable."
        : status === "error"
          ? lastError || "Connection failed."
          : null;

  return (
    <div className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-[#0d0e12]/70 p-6 backdrop-blur-xl transition-all hover:bg-[#0d0e12]/90 ${meta.border}`}>
      <div className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full ${meta.bg} opacity-10 blur-[70px] transition-opacity group-hover:opacity-20`} />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <ServiceIcon service={name} size="lg" />
          <div className="min-w-0">
            <div className="text-lg font-bold tracking-tight text-white">{meta.label}</div>
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
          {status !== "connected" ? (
            <Link href="/connections" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline">
              Connect <ArrowRight size={13} />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
