"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Shown in place of "Run now" while a SyncJob for this rule is RUNNING.
// Renders a live elapsed-time counter + a Cancel button that flips the
// job status to CANCELLED via the API. The engine notices on its next
// periodic checkpoint (~30s max) and unwinds, freeing the advisory lock.
export function CancelSyncButton({
  jobId,
  startedAt,
}: {
  jobId: string;
  startedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const id = window.setInterval(() => setElapsed(Math.max(0, Date.now() - start)), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const display = minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;

  async function cancel() {
    if (!confirm("Cancel this sync run? The engine will stop on its next checkpoint (≤30s).")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sync/run/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || `Could not cancel (${res.status})`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent)]">
        <Loader2 size={12} className="animate-spin" />
        Running · {display}
      </span>
      <button type="button" onClick={cancel} disabled={busy} className="btn btn-danger">
        <X size={16} />
        {busy ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}
