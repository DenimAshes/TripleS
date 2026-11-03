"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const RETRY_AFTER_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 24 * 3600 * 1000;

export function PlaylistsAutoRefresh({
  hasPlaylists,
  lastChangedAt,
}: {
  hasPlaylists: boolean;
  lastChangedAt: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const isStale = !lastChangedAt || Date.now() - new Date(lastChangedAt).getTime() > STALE_AFTER_MS;
    if (hasPlaylists && !isStale) return;

    const key = "playlists-auto-refresh";
    const lastAttempt = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastAttempt < RETRY_AFTER_MS) return;

    let controller: AbortController | null = null;
    let startTimer: number | null = null;
    const timers: number[] = [];

    startTimer = window.setTimeout(() => {
      sessionStorage.setItem(key, String(Date.now()));
      controller = new AbortController();
      void fetch("/api/playlists/refresh", {
        method: "POST",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) return;
        timers.push(window.setTimeout(() => router.refresh(), 2000));
        timers.push(window.setTimeout(() => router.refresh(), 10000));
        timers.push(window.setTimeout(() => router.refresh(), 30000));
      }).catch(() => {});
    }, 0);

    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer);
      controller?.abort();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [hasPlaylists, lastChangedAt, router]);

  return null;
}
