"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const RETRY_AFTER_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 24 * 3600 * 1000;

export function PlaylistTracksAutoRefresh({
  playlistId,
  hasTracks,
  lastFetchedAt,
}: {
  playlistId: string;
  hasTracks: boolean;
  lastFetchedAt: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const isStale = !lastFetchedAt || Date.now() - new Date(lastFetchedAt).getTime() > STALE_AFTER_MS;
    if (hasTracks && !isStale) return;

    const key = `playlist-tracks-refresh:${playlistId}`;
    const lastAttempt = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastAttempt < RETRY_AFTER_MS) return;

    sessionStorage.setItem(key, String(Date.now()));
    const controller = new AbortController();

    void fetch(`/api/playlists/${playlistId}/refresh`, {
      method: "POST",
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) return;
      router.refresh();
      window.setTimeout(() => router.refresh(), 5000);
    }).catch(() => {});

    return () => controller.abort();
  }, [hasTracks, lastFetchedAt, playlistId, router]);

  return null;
}
