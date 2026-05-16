"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollBrowserJob, startBrowserJob } from "./browserJobClient";

export function RefreshPlaylistTracksButton({ playlistId }: { playlistId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setStatus("Queued");
    setError(null);
    try {
      const started = await startBrowserJob("playlistTracks.refresh", { playlistId });
      setStatus(started.currentStep);
      const finished = await pollBrowserJob(started.id, (job) => setStatus(job.currentStep));
      if (finished.status === "failed") {
        setError(finished.error || "Could not update this playlist.");
        return;
      }
      router.refresh();
      window.setTimeout(() => router.refresh(), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this playlist.");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={refresh} disabled={loading} className="btn btn-ghost">
        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        {loading ? "Updating..." : "Update"}
      </button>
      {status ? <p className="max-w-80 text-right text-xs text-muted-fg">{status}</p> : null}
      {error ? <p className="max-w-80 text-right text-xs text-[#fca5a5]">{error}</p> : null}
    </div>
  );
}

