"use client";

import type { Playlist, SyncDestination, SyncRule } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncRuleForm({ playlists, rule }: { playlists: Playlist[]; rule?: SyncRule & { destinations: SyncDestination[] } }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(rule?.sourcePlaylistId || playlists[0]?.servicePlaylistId || "");
  const destinationIds = new Set(rule?.destinations.map((destination) => destination.playlistId) || []);
  const sourcePlaylist = playlists.find((playlist) => playlist.servicePlaylistId === sourceId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const source = playlists.find((item) => item.servicePlaylistId === data.get("sourcePlaylistId"));
    const destinations = playlists
      .filter((item) => item.isWritable && data.getAll("destinations").includes(item.servicePlaylistId))
      .map((item) => ({ service: item.service, playlistId: item.servicePlaylistId }));
    await fetch(rule ? `/api/sync-rules/${rule.id}` : "/api/sync-rules", {
      method: rule ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        sourceService: source?.service,
        sourcePlaylistId: data.get("sourcePlaylistId"),
        mode: data.get("mode"),
        intervalMinutes: Number(data.get("intervalMinutes")),
        isEnabled: data.get("isEnabled") === "on",
        destinations,
      }),
    });
    router.push(rule ? `/settings?rule=${rule.id}` : "/settings");
    router.refresh();
  }

  const writableDestinations = playlists.filter((playlist) => playlist.servicePlaylistId !== sourceId && playlist.isWritable);
  return (
    <form onSubmit={submit} className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#0d0e12]/80 p-8 backdrop-blur-2xl transition-all hover:border-blue-500/10">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white">{rule ? "Edit Sync Configuration" : "New Sync Protocol"}</h2>
        <p className="mt-2 text-xs font-bold uppercase tracking-widest text-slate-500">
          {rule ? "Update bridge parameters" : "Initialize cross-platform mapping"}
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Protocol Label</span>
          <input name="name" defaultValue={rule?.name || "Music Bridge"} placeholder="e.g., Daily Mix Sync" className="w-full rounded-xl border border-white/5 bg-black/40 p-3 text-sm font-bold text-white placeholder:text-slate-700 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all shadow-inner" />
        </label>

        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Origin Data Source</span>
          <select name="sourcePlaylistId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full rounded-xl border border-white/5 bg-black/40 p-3 text-sm font-bold text-white focus:border-blue-500/50 focus:outline-none transition-all cursor-pointer">
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.servicePlaylistId}>
                [{playlist.service}] — {playlist.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-8">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Destination Nodes</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {writableDestinations.map((playlist) => {
            const checked = destinationIds.has(playlist.servicePlaylistId);
            return (
              <label
                key={playlist.id}
                className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition duration-200 ${
                  checked
                    ? "border-blue-500/40 bg-blue-500/5 text-white"
                    : "border-white/5 bg-white/[0.02] text-slate-400 hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <input
                  name="destinations"
                  type="checkbox"
                  value={playlist.servicePlaylistId}
                  defaultChecked={checked}
                  className="!h-4 !w-4 cursor-pointer accent-blue-500"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-blue-500/60 text-xs font-bold">{playlist.service}:</span> <span className="ml-1">{playlist.name}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Operation Mode</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full rounded-xl border border-white/5 bg-black/40 p-2.5 text-xs font-bold text-white focus:outline-none">
            <option value="ADD_ONLY">Additive Sync</option>
            <option value="ADD_AND_REMOVE">Full Match</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Frequency</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full rounded-xl border border-white/5 bg-black/40 p-2.5 text-xs font-bold text-white focus:outline-none">
            <option value="15">15 Minutes</option>
            <option value="30">30 Minutes</option>
            <option value="60">60 Minutes</option>
            <option value="0">Manual Trigger</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end pb-1 text-xs font-bold text-slate-400">
          <div className="relative inline-block h-5 w-9 cursor-pointer">
            <input
              name="isEnabled"
              type="checkbox"
              defaultChecked={rule?.isEnabled ?? true}
              className="peer sr-only cursor-pointer"
            />
            <div className="absolute inset-0 rounded-full bg-white/5 transition-colors peer-checked:bg-blue-600" />
            <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-400 transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
          </div>
          <span className="uppercase tracking-widest">Protocol Active</span>
        </label>
      </div>

      <button type="submit" className="mt-8 w-full rounded-2xl bg-blue-600 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-[0_0_30px_rgba(37,99,235,0.3)] transition-all hover:bg-blue-500 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98]">
        {rule ? "Save changes" : "Create sync rule"}
      </button>
    </form>
  );
}
