"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Shown in place of "Run now" while a SyncJob for this rule is RUNNING.
// The engine sees cancellation on its next periodic checkpoint.
export function CancelSyncButton({ jobId, startedAt }: { jobId: string; startedAt: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const id = window.setInterval(() => setElapsed(Math.max(0, Date.now() - start)), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const seconds = elapsed === null ? null : Math.floor(elapsed / 1000);
  const minutes = seconds === null ? 0 : Math.floor(seconds / 60);
  const display = seconds === null ? null : minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sync/run/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Could not cancel (${res.status})`);
        return;
      }
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent)]">
          <Loader2 size={12} className="animate-spin" />
          {display ? `Running - ${display}` : "Running"}
        </span>
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <button type="button" onClick={cancel} disabled={busy} className="btn btn-danger">
              <X size={16} />
              {busy ? "Cancelling..." : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="btn btn-ghost">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="btn btn-danger">
            <X size={16} />
            Cancel
          </button>
        )}
      </div>
      {confirming ? <p className="max-w-80 text-right text-xs text-muted-fg">Stops on the next engine checkpoint, usually within 30s.</p> : null}
      {error ? <p className="max-w-80 text-right text-xs text-[#fca5a5]">{error}</p> : null}
    </div>
  );
}
