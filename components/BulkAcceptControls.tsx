"use client";

import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Client controls for one-click approval of every PENDING manual review
// candidate whose top-candidate confidence is >= the chosen threshold.
// Uses /api/manual-match/bulk-accept with preview=true first to show how
// many cards would be cleared before the user commits.
export function BulkAcceptControls({ totalPending }: { totalPending: number }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(0.85);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function preview(newThreshold: number) {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/manual-match/bulk-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: newThreshold, preview: true }),
      });
      const data = await res.json();
      setPreviewCount(typeof data.count === "number" ? data.count : 0);
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!previewCount) return;
    if (!confirm(`Approve ${previewCount} pending review${previewCount === 1 ? "" : "s"} at ≥${Math.round(threshold * 100)}% confidence?`)) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/manual-match/bulk-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutcome(data.error || `Failed (${res.status})`);
      } else {
        setOutcome(
          `Approved ${data.accepted}${data.failed ? `, ${data.failed} failed (${(data.errors || []).slice(0, 2).join("; ")})` : ""}.`,
        );
        setPreviewCount(null);
        router.refresh();
      }
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : "Bulk approve failed");
    } finally {
      setBusy(false);
    }
  }

  function onThresholdChange(value: number) {
    setThreshold(value);
    setPreviewCount(null);
  }

  if (totalPending === 0) return null;

  return (
    <div className="panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--text)]">Approve high-confidence matches in bulk</div>
        <div className="mt-0.5 text-xs text-muted-fg">
          One-click {totalPending}-card cleanup. Each card&apos;s top alternative becomes the confirmed match.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-fg">
          <span>Threshold</span>
          <input
            type="range"
            min="0.6"
            max="1"
            step="0.01"
            value={threshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
            className="!h-1 !w-32 !border-0 !bg-[var(--surface-2)] !p-0 accent-[var(--accent)]"
          />
          <span className="tabular-nums font-semibold text-[var(--text)]">{Math.round(threshold * 100)}%</span>
        </label>
        <button
          type="button"
          onClick={() => preview(threshold)}
          disabled={busy}
          className="btn btn-ghost"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy || !previewCount}
          className="btn btn-primary"
        >
          <Zap size={16} />
          {previewCount != null ? `Approve ${previewCount}` : "Approve"}
        </button>
      </div>
      {outcome ? (
        <div className="basis-full text-xs text-emerald-400">{outcome}</div>
      ) : null}
    </div>
  );
}
