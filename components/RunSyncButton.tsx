"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";

export function RunSyncButton({ ruleId, children }: { ruleId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setStatus("Queued");
    setError(null);
    try {
      const started = await startBrowserJob("sync.run", { syncRuleId: ruleId });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep));
      if (finished.status === "failed" || finished.status === "cancelled") {
        const action = finished.errorDetails?.recommendedAction;
        const counts =
          finished.errorDetails?.activeTracks !== undefined && finished.errorDetails?.expectedTracks !== undefined
            ? ` (${finished.errorDetails.activeTracks}/${finished.errorDetails.expectedTracks})`
            : "";
        setError(`${finished.errorCode ? `${finished.errorCode}: ` : ""}${finished.error || "Could not run sync."}${counts}${action ? ` ${action}` : ""}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run sync.");
    } finally {
      setRunning(false);
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={run} disabled={running} className="btn btn-primary">
        {running ? "Running..." : children}
      </button>
      {status ? <p className="max-w-80 text-right text-xs text-muted-fg">{status}</p> : null}
      {error ? <p className="max-w-80 text-right text-xs text-[#fca5a5]">{error}</p> : null}
    </div>
  );
}
