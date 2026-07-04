"use client";

import { Play, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RunDueSyncResult = {
  summary?: {
    due: number;
    succeeded: number;
    failed: number;
    skipped: number;
    staleMarked: number;
  };
  error?: string;
};

export function RunDueSyncQueueButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDueQueue() {
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/sync/queue/run-due", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as RunDueSyncResult;
      if (!response.ok) {
        setError(data.error || "Could not run sync queue.");
        return;
      }

      const summary = data.summary;
      if (summary) {
        setMessage(`${summary.succeeded} ran, ${summary.failed} failed, ${summary.skipped} skipped`);
      } else {
        setMessage("Queue run finished.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run sync queue.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button onClick={runDueQueue} disabled={running || disabled} className="btn btn-primary inline-flex items-center gap-2">
        {running ? <RotateCw size={16} className="animate-spin" /> : <Play size={16} />}
        {running ? "Running queue..." : "Run due sync"}
      </button>
      {message ? <p className="max-w-72 text-left text-xs text-muted-fg sm:text-right">{message}</p> : null}
      {error ? <p className="max-w-72 text-left text-xs text-[#fca5a5] sm:text-right">{error}</p> : null}
    </div>
  );
}
