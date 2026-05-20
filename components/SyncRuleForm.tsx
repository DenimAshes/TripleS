"use client";

import type { Playlist, SyncDestination, SyncRule } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

export function SyncRuleForm({ playlists, rule }: { playlists: Playlist[]; rule?: SyncRule & { destinations: SyncDestination[] } }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(rule?.sourcePlaylistId || playlists[0]?.servicePlaylistId || "");
  const destinationIds = new Set(rule?.destinations.map((destination) => destination.playlistId) || []);

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
    <form onSubmit={submit} className="panel p-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white">{rule ? "Edit sync rule" : "New sync rule"}</h2>
        <p className="mt-2 text-sm text-muted-fg">
          Pick one source playlist and the destination playlists that should receive new songs.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Rule name</span>
          <input
            name="name"
            defaultValue={rule?.name || "Music Bridge"}
            placeholder="e.g. Daily Mix Sync"
            className="w-full"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Source playlist</span>
          <select name="sourcePlaylistId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full">
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.servicePlaylistId}>
                {serviceMeta(playlist.service).label} - {playlist.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-8">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Copy to</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {writableDestinations.map((playlist) => {
            const checked = destinationIds.has(playlist.servicePlaylistId);
            return (
              <label
                key={playlist.id}
                className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition duration-200 ${
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
                <ServiceIcon service={playlist.service} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-xs font-bold text-blue-500/70">{serviceMeta(playlist.service).shortLabel}:</span>
                  <span className="ml-1">{playlist.name}</span>
                </span>
              </label>
            );
          })}
          {!writableDestinations.length ? (
            <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-muted-fg sm:col-span-2">
              No writable destination playlists are available yet.
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sync mode</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full">
            <option value="ADD_ONLY">Add new songs only</option>
            <option value="ADD_AND_REMOVE">Add and remove</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Frequency</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full">
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">60 minutes</option>
            <option value="0">Manual only</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end pb-1 text-xs font-bold text-slate-400">
          <span className="relative inline-block h-5 w-9 cursor-pointer">
            <input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} className="peer sr-only" />
            <span className="absolute inset-0 rounded-full bg-white/5 transition-colors peer-checked:bg-blue-600" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-400 transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
          </span>
          <span className="uppercase tracking-widest">Rule active</span>
        </label>
      </div>

      <button type="submit" className="btn btn-primary mt-8 w-full">
        {rule ? "Save changes" : "Create sync rule"}
      </button>
    </form>
  );
}
