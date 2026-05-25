"use client";

import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const POLL_DELAYS_MS = [2_000, 10_000, 30_000];

export function RefreshPlaylistsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const timersRef = useRef<number[]>([]);

  function clearTimers() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!outcome?.ok) return;
    const id = window.setTimeout(() => setOutcome(null), 4000);
    return () => window.clearTimeout(id);
  }, [outcome]);

  async function refresh() {
    if (loading) return;
    clearTimers();
    setLoading(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/playlists/refresh", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setOutcome({ ok: false, message: body?.error || `Refresh failed (${response.status})` });
        return;
      }
      setOutcome({ ok: true, message: "Refreshing in the background…" });
      router.refresh();
      // Background workers populate the cache asynchronously — poll a few times
      // so the UI catches up without forcing the user to hit refresh again.
      for (const delay of POLL_DELAYS_MS) {
        const id = window.setTimeout(() => router.refresh(), delay);
        timersRef.current.push(id);
      }
    } catch (error) {
      setOutcome({ ok: false, message: error instanceof Error ? error.message : "Refresh failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button onClick={refresh} className="btn btn-ghost" disabled={loading}>
        <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> {loading ? "Updating…" : "Update"}
      </button>
      {outcome ? (
        <span
          className={`inline-flex items-center gap-1 text-xs font-semibold ${
            outcome.ok ? "text-emerald-300" : "text-rose-300"
          }`}
          role="status"
          aria-live="polite"
        >
          {outcome.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {outcome.message}
        </span>
      ) : null}
    </div>
  );
}
