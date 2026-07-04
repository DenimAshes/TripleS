"use client";

import { ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

type HistoryJob = {
  id: string;
  status: string;
  errorKind: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  synced: number;
  alreadySynced: number;
  notFound: number;
  manualRequired: number;
  removed: number;
};

function formatRelative(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// Inline run-history block for a SyncRule. Lazy-loads on first expand so the
// dashboard doesn't fan out N requests for rules whose history nobody opens.
export function SyncRuleHistory({ ruleId }: { ruleId: string }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<HistoryJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    let aborted = false;

    async function load(showSpinner: boolean) {
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/sync-rules/${ruleId}/history`);
        if (!res.ok) {
          throw new Error((await res.json().catch(() => null))?.error || `Failed (${res.status})`);
        }
        const data = await res.json();
        if (aborted) return;
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setError(null);
      } catch (err) {
        if (aborted) return;
        setError(err instanceof Error ? err.message : "Could not load history");
      } finally {
        if (!aborted && showSpinner) setLoading(false);
      }
    }

    if (jobs === null) void load(true);
    const id = window.setInterval(() => void load(false), 10_000);
    return () => {
      aborted = true;
      window.clearInterval(id);
    };
  }, [open, jobs, ruleId]);

  return (
    <div className="mt-4 border-t border-[var(--border-soft)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-fg transition hover:text-[var(--text)]"
      >
        <Clock3 size={12} />
        Run history
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open ? (
        <div className="mt-3 space-y-1.5">
          {loading ? <div className="text-xs text-dim-fg">Loading...</div> : null}
          {error ? <div className="text-xs text-[#fca5a5]">{error}</div> : null}
          {jobs && jobs.length === 0 ? (
            <div className="text-xs text-dim-fg">No runs yet.</div>
          ) : null}
          {jobs?.map((job) => (
            <div
              key={job.id}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)]/60 p-2.5 text-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={job.status.toLowerCase()} />
                  <span className="text-muted-fg">{formatRelative(job.startedAt, nowMs)}</span>
                  <span className="text-dim-fg">/</span>
                  <span className="text-dim-fg tabular-nums">{formatDuration(job.durationMs)}</span>
                </div>
                <div className="text-dim-fg tabular-nums">
                  {job.synced ? <span className="text-emerald-400">+{job.synced} </span> : null}
                  {job.alreadySynced ? <span className="text-muted-fg">={job.alreadySynced} </span> : null}
                  {job.manualRequired ? <span className="text-[#fcd34d]">?{job.manualRequired} </span> : null}
                  {job.notFound ? <span className="text-[#fca5a5]">!{job.notFound} </span> : null}
                  {job.removed ? <span className="text-[#fca5a5]">-{job.removed}</span> : null}
                </div>
              </div>
              {job.errorMessage ? (
                <div className="mt-1.5 truncate text-[#fca5a5]" title={job.errorMessage}>
                  {job.errorKind ? <span className="font-semibold uppercase">[{job.errorKind}] </span> : null}
                  {job.errorMessage}
                </div>
              ) : null}
            </div>
          ))}
          {jobs?.length ? (
            <div className="pt-1 text-[10px] text-dim-fg">
              <span className="text-emerald-400">+</span> added{" "}
              <span className="ml-2 text-muted-fg">=</span> already there{" "}
              <span className="ml-2 text-[#fcd34d]">?</span> needs review{" "}
              <span className="ml-2 text-[#fca5a5]">!</span> not found{" "}
              <span className="ml-2 text-[#fca5a5]">-</span> removed
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
