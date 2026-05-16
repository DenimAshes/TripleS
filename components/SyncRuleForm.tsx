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
    <form onSubmit={submit} className="panel space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{rule ? "Edit playlist copy" : "Create playlist copy"}</h2>
        <p className="mt-1 text-sm text-muted-fg">
          {rule ? "Changes update where songs are copied." : "Choose where songs should be copied."}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-fg">Name</span>
        <input name="name" defaultValue={rule?.name || "Playlist copy"} className="w-full" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-fg">Main playlist</span>
        <select name="sourcePlaylistId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full">
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.servicePlaylistId}>
              {playlist.service}: {playlist.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-fg">Copy to</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {writableDestinations.map((playlist) => {
            const checked = destinationIds.has(playlist.servicePlaylistId);
            return (
              <label
                key={playlist.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                  checked
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)]"
                    : "border-[var(--border-soft)] bg-[var(--surface-2)] hover:border-[var(--border)]"
                }`}
              >
                <input
                  name="destinations"
                  type="checkbox"
                  value={playlist.servicePlaylistId}
                  defaultChecked={checked}
                  className="!h-4 !w-4 cursor-pointer accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-dim-fg">{playlist.service}:</span> {playlist.name}
                </span>
              </label>
            );
          })}
          {sourcePlaylist && writableDestinations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-soft)] px-3 py-2.5 text-sm text-muted-fg">
              No writable playlists available.
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-fg">Behavior</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full">
            <option value="ADD_ONLY">Add new songs</option>
            <option value="ADD_AND_REMOVE">Keep matched</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-fg">Repeat</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full">
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="0">Manual</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            name="isEnabled"
            type="checkbox"
            defaultChecked={rule?.isEnabled ?? true}
            className="!h-4 !w-4 cursor-pointer accent-[var(--accent)]"
          />{" "}
          Active
        </label>
      </div>
      <button type="submit" className="btn btn-primary">
        {rule ? "Save" : "Create"}
      </button>
    </form>
  );
}
