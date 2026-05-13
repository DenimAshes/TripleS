"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshPlaylistTracksButton({ playlistId }: { playlistId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/playlists/${playlistId}/refresh`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Could not update this playlist.");
      } else {
        router.refresh();
        window.setTimeout(() => router.refresh(), 5000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this playlist.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm disabled:opacity-60"
      >
        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        {loading ? "Updating..." : "Update"}
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
