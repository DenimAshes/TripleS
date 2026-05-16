"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshPlaylistsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    await fetch("/api/playlists/refresh", { method: "POST" });
    setLoading(false);
    router.refresh();
    window.setTimeout(() => router.refresh(), 2000);
    window.setTimeout(() => router.refresh(), 10000);
    window.setTimeout(() => router.refresh(), 30000);
  }
  return (
    <button onClick={refresh} className="btn btn-ghost" disabled={loading}>
      <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Update
    </button>
  );
}
