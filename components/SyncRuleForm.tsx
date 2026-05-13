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

  return (
    <form onSubmit={submit} className="panel space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">{rule ? "Edit playlist copy" : "Create playlist copy"}</h2>
        <p className="mt-1 text-sm text-[#666a73]">{rule ? "Changes update where songs are copied." : "Choose where songs should be copied."}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input name="name" defaultValue={rule?.name || "Playlist copy"} className="w-full rounded-md border border-[#deded8] px-3 py-2" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Main playlist</span>
        <select name="sourcePlaylistId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full rounded-md border border-[#deded8] px-3 py-2">
          {playlists.map((playlist) => <option key={playlist.id} value={playlist.servicePlaylistId}>{playlist.service}: {playlist.name}</option>)}
        </select>
      </label>
      <div>
        <div className="mb-2 text-sm font-medium">Copy to</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {playlists.filter((playlist) => playlist.servicePlaylistId !== sourceId && playlist.isWritable).map((playlist) => (
            <label key={playlist.id} className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm">
              <input name="destinations" type="checkbox" value={playlist.servicePlaylistId} defaultChecked={destinationIds.has(playlist.servicePlaylistId)} className="mr-2" />
              {playlist.service}: {playlist.name}
            </label>
          ))}
          {sourcePlaylist && playlists.filter((playlist) => playlist.servicePlaylistId !== sourceId && playlist.isWritable).length === 0 ? (
            <div className="rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm text-[#666a73]">No writable playlists available.</div>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Behavior</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full rounded-md border border-[#deded8] px-3 py-2">
            <option value="ADD_ONLY">Add new songs</option>
            <option value="ADD_AND_REMOVE">Keep matched</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Repeat</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full rounded-md border border-[#deded8] px-3 py-2">
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="0">Manual</option>
          </select>
        </label>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} /> Active
        </label>
      </div>
      <button className="rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white">{rule ? "Save" : "Create"}</button>
    </form>
  );
}
