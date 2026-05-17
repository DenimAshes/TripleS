"use client";

import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

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

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SERVICE_LABELS: Record<string, string> = {
  SPOTIFY: "Spotify",
  YOUTUBE: "YouTube Music",
  SOUNDCLOUD: "SoundCloud",
};

export function ServiceStatusRow(props: ServiceStatusRowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

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
              ? "Got 0 playlists — service returned an empty list."
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

  // Decide the headline pill text. The most actionable state for the user
  // is "not connected" (paste the cookie) vs "connected but isMock" (a
  // stale row from earlier mock init — we now fix this server-side, but
  // call it out anyway).
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
    stateLabel = "issues";
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

  return (
    <div className="panel-inset flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[var(--text)]">{SERVICE_LABELS[props.service] || props.service}</span>
          <span className={pillClass}>{stateLabel}</span>
        </div>
        <div className="mt-1 text-xs text-muted-fg">
          <span className="tabular-nums text-[var(--text)]">{props.playlistCount}</span>{" "}
          {props.playlistCount === 1 ? "playlist" : "playlists"}
          {props.hiddenCount > 0 ? <span className="text-dim-fg"> · {props.hiddenCount} hidden</span> : null}
          <span className="mx-2 text-dim-fg">·</span>
          <span>last updated {formatRelative(props.lastFetchedAt)}</span>
        </div>
        {state === "missing" ? (
          <div className="mt-1.5 text-xs text-[#fcd34d]">
            Paste your {SERVICE_LABELS[props.service] || props.service} cookie in{" "}
            <Link href="/settings" className="font-medium text-[var(--accent)] hover:underline">
              Settings
            </Link>
            .
          </div>
        ) : null}
        {state === "needs_login" || state === "warn" ? (
          <div className="mt-1.5 text-xs text-[#fcd34d]">
            {props.lastError ? props.lastError.slice(0, 200) : "Session needs attention. Re-login in Settings."}
          </div>
        ) : null}
        {state === "mock" ? (
          <div className="mt-1.5 text-xs text-[#fcd34d]">
            Account is still flagged as mock — re-paste the cookie in{" "}
            <Link href="/settings" className="font-medium text-[var(--accent)] hover:underline">
              Settings
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
        className="btn btn-ghost shrink-0"
      >
        <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        {busy ? "Loading…" : "Refresh"}
      </button>
    </div>
  );
}
