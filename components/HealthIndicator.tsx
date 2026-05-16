"use client";

import { useEffect, useState } from "react";

type Health = "ok" | "warn" | "fail" | "unknown";

// Tiny pulse-dot in the header that polls /api/health every ~60s. Green when
// everything is fine, amber on a soft warn (e.g. stale-running sync job or
// missing CloakBrowser binary), red on hard fail (DB unreachable). No copy
// by default — hover/tap for the last seen state.
export function HealthIndicator() {
  const [health, setHealth] = useState<Health>("unknown");
  const [detail, setDetail] = useState<string>("Checking…");

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setHealth("fail");
          setDetail(data?.checks?.db?.error || `HTTP ${res.status}`);
          return;
        }
        const dbLatency = data?.checks?.db?.latencyMs;
        const staleRunning = data?.checks?.lastSyncJob?.staleRunning;
        if (staleRunning) {
          setHealth("warn");
          setDetail("Sync job is running long — may be stuck");
          return;
        }
        setHealth("ok");
        setDetail(`DB ${dbLatency != null ? `${dbLatency}ms` : "OK"}`);
      } catch (error) {
        if (cancelled) return;
        setHealth("fail");
        setDetail(error instanceof Error ? error.message : "fetch failed");
      }
    }

    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const color =
    health === "ok"
      ? "bg-emerald-400"
      : health === "warn"
        ? "bg-amber-400"
        : health === "fail"
          ? "bg-red-400"
          : "bg-slate-500";

  const label =
    health === "ok"
      ? "All systems normal"
      : health === "warn"
        ? "Attention"
        : health === "fail"
          ? "System issue"
          : "Checking…";

  return (
    <div
      className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500"
      title={`${label} — ${detail}`}
    >
      <span className="relative inline-flex h-2 w-2">
        <span className={`absolute inset-0 rounded-full ${color} opacity-60 animate-ping`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
