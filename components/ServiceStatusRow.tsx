"use client";

import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

export type ServiceStatusRowProps = {
  service: string;
  connected: boolean;
  connectionStatus: string | null;
  isMock: boolean;
  lastError: string | null;
  playlistCount: number;
  hiddenCount: number;
  lastFetchedAt: string | null;
};

function formatRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ServiceStatusRow(props: ServiceStatusRowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [nowMs] = useState(() => Date.now());

  async function refresh() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/playlists/refresh/${props.service.toLowerCase()}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setOutcome({
          ok: false,
          message: data.error || `Refresh failed${res.status ? ` (${res.status})` : ""}`,
        });
      } else {
        setOutcome({
          ok: true,
          message:
            data.count === 0
              ? "Got 0 playlists. The service returned an empty list."
              : `Fetched ${data.count} playlist${data.count === 1 ? "" : "s"}.`,
        });
        router.refresh();
      }
    } catch (err) {
      setOutcome({ ok: false, message: err instanceof Error ? err.message : "Refresh failed" });
    } finally {
      setBusy(false);
    }
  }

  let state: "connected" | "needs_login" | "mock" | "missing" | "warn";
  let stateLabel: string;
  if (!props.connectionStatus) {
    state = "missing";
    stateLabel = "not connected";
  } else if (props.connectionStatus === "NEEDS_LOGIN") {
    state = "needs_login";
    stateLabel = "session expired";
  } else if (props.isMock) {
    state = "mock";
    stateLabel = "mock mode";
  } else if (props.lastError) {
    state = "warn";
    stateLabel = "needs attention";
  } else {
    state = "connected";
    stateLabel = "connected";
  }

  const pillClass =
    state === "connected"
      ? "pill pill-success"
      : state === "needs_login" || state === "mock"
        ? "pill pill-warning"
        : state === "warn"
          ? "pill pill-warning"
          : "pill";
  const meta = serviceMeta(props.service);

  const glow =
    meta.key === "SPOTIFY"
      ? "service-glow-spotify"
      : meta.key === "YOUTUBE"
        ? "service-glow-youtube"
        : meta.key === "SOUNDCLOUD"
          ? "service-glow-soundcloud"
          : "";
  const lastFetchedIso = props.lastFetchedAt;
  const stale = lastFetchedIso ? nowMs - new Date(lastFetchedIso).getTime() > 24 * 3_600_000 : false;

  return (
    <div className={`panel-inset animated-sheen ${glow} relative flex flex-col gap-3 overflow-hidden p-4 text-sm sm:flex-row sm:items-center sm:justify-between`}>
      <span className={`pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full ${meta.bg} opacity-70`} />
      <div className="relative min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <ServiceIcon service={props.service} size="sm" />
          <span className="font-semibold text-[var(--text)]">{meta.label}</span>
          <span className={pillClass}>{stateLabel}</span>
          {state === "connected" && stale ? (
            <span className="pill pill-warning" title="No fresh fetch in over 24 hours">
              stale
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-fg">
          <span className="tabular-nums text-[var(--text)]">{props.playlistCount}</span>{" "}
          {props.playlistCount === 1 ? "playlist" : "playlists"}
          {props.hiddenCount > 0 ? <span className="text-dim-fg"> / {props.hiddenCount} hidden</span> : null}
          <span className="mx-2 text-dim-fg">/</span>
          <span>last updated {formatRelative(props.lastFetchedAt, nowMs)}</span>
        </div>
        {state === "missing" ? (
          <div className="mt-1.5 text-xs text-[#fcd34d]">
            Connect {meta.label} in{" "}
            <Link href="/connections" className="font-medium text-[var(--accent)] hover:underline">
              Connections
            </Link>
            .
          </div>
        ) : null}
        {state === "needs_login" || state === "warn" ? (
          <div
            className="mt-1.5 max-w-3xl truncate text-xs text-[#fcd34d]"
            title={props.lastError || "Session needs attention. Reconnect it in Connections."}
          >
            {props.lastError ? props.lastError.split("\n")[0].slice(0, 110) : "Session needs attention. Reconnect it in Connections."}
          </div>
        ) : null}
        {state === "mock" ? (
          <div className="mt-1.5 text-xs text-[#fcd34d]">
            Account is still flagged as mock. Reconnect it in{" "}
            <Link href="/connections" className="font-medium text-[var(--accent)] hover:underline">
              Connections
            </Link>{" "}
            to switch to live mode.
          </div>
        ) : null}
        {outcome ? (
          <div className={`mt-1.5 inline-flex items-center gap-1.5 text-xs ${outcome.ok ? "text-emerald-400" : "text-[#fca5a5]"}`}>
            {outcome.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {outcome.message}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={refresh}
        disabled={busy || state === "missing"}
        className="btn btn-ghost surface-lift relative shrink-0"
      >
        <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        {busy ? "Loading..." : "Refresh"}
      </button>
    </div>
  );
}
