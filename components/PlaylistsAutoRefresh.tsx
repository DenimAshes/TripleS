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

    sessionStorage.setItem(key, String(Date.now()));
    const controller = new AbortController();

    void fetch("/api/playlists/refresh", {
      method: "POST",
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) return;
      window.setTimeout(() => router.refresh(), 2000);
      window.setTimeout(() => router.refresh(), 10000);
      window.setTimeout(() => router.refresh(), 30000);
    }).catch(() => {});

    return () => controller.abort();
  }, [hasPlaylists, lastChangedAt, router]);

  return null;
}
