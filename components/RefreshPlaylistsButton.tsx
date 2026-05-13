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
    <button onClick={refresh} className="inline-flex items-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm">
      <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Update
    </button>
  );
}
