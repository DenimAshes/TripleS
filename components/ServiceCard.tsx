import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Callout } from "./Callout";
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

// The dashboard's read-only summary of one connection. It is deliberately the
// same panel + brand tint as the editable card on /connections, so moving
// between the two pages doesn't feel like moving between two apps.
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
    <div className={`panel ${meta.tint} ${meta.border} min-w-0 p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ServiceIcon service={name} size="lg" />
          <div className="min-w-0">
            <div className="text-base font-semibold text-[var(--text)]">{meta.label}</div>
            <div className="mt-0.5 truncate text-xs text-muted-fg">{username || "Not linked"}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={status} />
          {status !== "connected" ? (
            <Link
              href="/connections"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Connect <ArrowRight size={13} />
            </Link>
          ) : null}
        </div>
      </div>
      {statusMessage ? (
        <Callout tone={status === "error" ? "danger" : "warning"} className="mt-4">
          <span title={lastError || undefined}>{statusMessage}</span>
        </Callout>
      ) : null}
    </div>
  );
}
