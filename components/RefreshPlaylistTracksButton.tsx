"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";

export function RefreshPlaylistTracksButton({ playlistId }: { playlistId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    pollControllerRef.current?.abort();
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  async function refresh() {
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    setLoading(true);
    setStatus("Queued");
    setError(null);
    try {
      const started = await startBrowserJob("playlistTracks.refresh", { playlistId });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep), controller.signal);
      if (finished.status === "failed") {
        setError(finished.error || "Could not update this playlist.");
        return;
      }
      router.refresh();
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 5000);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not update this playlist.");
    } finally {
      if (pollControllerRef.current === controller) pollControllerRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        setStatus(null);
      }
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={refresh} disabled={loading} className="btn btn-ghost">
        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        {loading ? "Updating…" : "Update"}
      </button>
      {status ? <p role="status" aria-live="polite" className="max-w-80 text-right text-xs text-muted-fg">{status}</p> : null}
      {error ? <p role="alert" className="max-w-80 text-right text-xs text-danger-fg">{error}</p> : null}
    </div>
  );
}
