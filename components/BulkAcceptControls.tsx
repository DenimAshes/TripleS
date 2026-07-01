"use client";

import { Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "accept" | "reject";

type PreviewCandidate = {
  id: string;
  confidence: number;
  sourceServiceTrackId: string;
  sourceService?: string;
  sourceTitle?: string;
  sourceArtists?: string[];
  candidateServiceTrackId: string;
  candidateService?: string;
  candidateTitle?: string;
  candidateArtists?: string[];
  targetService: string;
};

type PreviewState = {
  count: number;
  remaining: number;
  candidates: PreviewCandidate[];
};

type CardConfig = {
  mode: Mode;
  title: string;
  description: string;
  endpoint: string;
  buttonIcon: React.ReactNode;
  buttonClass: string;
  buttonLabel: string;
  confirmVerb: string;
  successVerb: string;
  thresholdLabel: string;
  thresholdMin: number;
  thresholdMax: number;
  defaultThreshold: number;
  thresholdHelp: string;
  outcomeCountKey: "accepted" | "rejected";
};

const CONFIGS: Record<Mode, CardConfig> = {
  accept: {
    mode: "accept",
    title: "Approve high-confidence matches",
    description: "Each card's top alternative becomes the confirmed match.",
    endpoint: "/api/manual-match/bulk-accept",
    buttonIcon: <Zap size={16} />,
    buttonClass: "btn btn-primary",
    buttonLabel: "Approve",
    confirmVerb: "Approve",
    successVerb: "Approved",
    thresholdLabel: ">=",
    thresholdMin: 0.6,
    thresholdMax: 1,
    defaultThreshold: 0.85,
    thresholdHelp: "Anything below stays in the queue for hand review.",
    outcomeCountKey: "accepted",
  },
  reject: {
    mode: "reject",
    title: "Skip obvious mismatches",
    description: "Each rejected card stamps a negative-cache entry so the same target isn't re-suggested.",
    endpoint: "/api/manual-match/bulk-reject",
    buttonIcon: <Trash2 size={16} />,
    buttonClass: "btn btn-danger",
    buttonLabel: "Skip",
    confirmVerb: "Skip",
    successVerb: "Skipped",
    thresholdLabel: "<=",
    thresholdMin: 0.55,
    thresholdMax: 0.85,
    defaultThreshold: 0.7,
    thresholdHelp: "Cards above stay so you can review them by hand.",
    outcomeCountKey: "rejected",
  },
};

function BulkSection({ config, totalPending }: { config: CardConfig; totalPending: number }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(config.defaultThreshold);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function preview(newThreshold: number) {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: newThreshold, preview: true }),
      });
      const data = await res.json();
      setPreviewState({
        count: typeof data.count === "number" ? data.count : 0,
        remaining: typeof data.remaining === "number" ? data.remaining : 0,
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
      });
      setConfirming(false);
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!previewState?.count) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutcome(data.error || `Failed (${res.status})`);
      } else {
        const count = data[config.outcomeCountKey] ?? 0;
        const scheduled = typeof data.scheduledRules === "number" && data.scheduledRules > 0 ? ` Sync queued for ${data.scheduledRules} source${data.scheduledRules === 1 ? "" : "s"}.` : "";
        setOutcome(
          `${config.successVerb} ${count}${data.failed ? `, ${data.failed} failed (${(data.errors || []).slice(0, 2).join("; ")})` : ""}.${scheduled}`,
        );
        setPreviewState(null);
        setConfirming(false);
        router.refresh();
      }
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : "Bulk operation failed");
    } finally {
      setBusy(false);
    }
  }

  function onThresholdChange(value: number) {
    setThreshold(value);
    setPreviewState(null);
    setConfirming(false);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--text)]">{config.title}</div>
        <div className="mt-0.5 text-xs text-muted-fg">
          {totalPending}-card queue. {config.description}
        </div>
        <div className="mt-0.5 text-xs text-dim-fg">{config.thresholdHelp}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-fg">
          <span>{config.thresholdLabel}</span>
          <input
            type="range"
            min={config.thresholdMin}
            max={config.thresholdMax}
            step="0.01"
            value={threshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
            className="!h-1 !w-32 !border-0 !bg-[var(--surface-2)] !p-0 accent-[var(--accent)]"
          />
          <span className="tabular-nums font-semibold text-[var(--text)]">{Math.round(threshold * 100)}%</span>
        </label>
        <button type="button" onClick={() => preview(threshold)} disabled={busy} className="btn btn-ghost">
          Preview
        </button>
        {confirming && previewState?.count ? (
          <>
            <span className="text-xs text-muted-fg">
              {config.confirmVerb} {previewState.count} at {config.thresholdLabel}
              {Math.round(threshold * 100)}%?
            </span>
            <button type="button" onClick={apply} disabled={busy} className={config.buttonClass}>
              {config.buttonIcon}
              Confirm
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="btn btn-ghost">
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || !previewState?.count}
            className={config.buttonClass}
          >
            {config.buttonIcon}
            {previewState ? `${config.buttonLabel} ${previewState.count}` : config.buttonLabel}
          </button>
        )}
      </div>
      {previewState ? (
        <div className="basis-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
          {previewState.count > 0 ? (
            <>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent-fg">
                Previewing {previewState.candidates.length} of {previewState.count}
              </div>
              <div className="grid gap-2">
                {previewState.candidates.map((candidate) => (
                  <div key={candidate.id} className="grid gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--text)]">{candidate.sourceTitle || candidate.sourceServiceTrackId}</div>
                      <div className="truncate text-dim-fg">
                        {(candidate.sourceArtists || []).join(", ") || candidate.sourceService || "Source"}
                      </div>
                    </div>
                    <div className="hidden text-muted-fg sm:block">→</div>
                    <div className="min-w-0 sm:text-right">
                      <div className="truncate font-semibold text-[var(--text)]">{candidate.candidateTitle || candidate.candidateServiceTrackId}</div>
                      <div className="truncate text-dim-fg">
                        {(candidate.candidateArtists || []).join(", ") || candidate.candidateService || candidate.targetService}
                        <span className="ml-2 font-black text-[var(--text)]">{Math.round(candidate.confidence * 100)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {previewState.remaining > 0 ? (
                <div className="mt-2 text-xs text-muted-fg">+ {previewState.remaining} more will be included.</div>
              ) : null}
            </>
          ) : (
            <div className="text-xs text-muted-fg">No songs match this threshold.</div>
          )}
        </div>
      ) : null}
      {outcome ? (
        <div className={`basis-full text-xs ${outcome.startsWith(config.successVerb) ? "text-emerald-400" : "text-[#fca5a5]"}`}>
          {outcome}
        </div>
      ) : null}
    </div>
  );
}

// Bulk controls for the manual-review queue: high-confidence Approve on top,
// low-confidence Skip below. Each side previews first so the user sees the
// exact count before committing, and both refresh the page on success so the
// cards drop out without a manual reload.
export function BulkAcceptControls({ totalPending }: { totalPending: number }) {
  if (totalPending === 0) return null;
  return (
    <div className="panel mb-4 divide-y divide-[var(--border-soft)] p-4">
      <div className="pb-4">
        <BulkSection config={CONFIGS.accept} totalPending={totalPending} />
      </div>
      <div className="pt-4">
        <BulkSection config={CONFIGS.reject} totalPending={totalPending} />
      </div>
    </div>
  );
}
