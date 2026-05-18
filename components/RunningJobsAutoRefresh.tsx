"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While at least one SyncJob is RUNNING the dashboard otherwise sits frozen —
// progress bars, timers, and history won't change until the user reloads.
// Poll router.refresh on a slow tick so server-rendered counters advance
// naturally, then stop the moment no jobs are running.
export function RunningJobsAutoRefresh({ runningCount }: { runningCount: number }) {
  const router = useRouter();

  useEffect(() => {
    if (runningCount === 0) return;
    const id = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(id);
  }, [runningCount, router]);

  return null;
}
