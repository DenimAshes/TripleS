"use client";

import type { Playlist, SyncDestination, SyncRule } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

const SERVICE_ORDER = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];

export function SyncRuleForm({ playlists, rule }: { playlists: Playlist[]; rule?: SyncRule & { destinations: SyncDestination[] } }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(rule?.sourcePlaylistId || playlists[0]?.servicePlaylistId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destinationIds = new Set(rule?.destinations.map((destination) => destination.playlistId) || []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const source = playlists.find((item) => item.servicePlaylistId === data.get("sourcePlaylistId"));
    const destinations = playlists
      .filter((item) => item.isWritable && data.getAll("destinations").includes(item.servicePlaylistId))
      .map((item) => ({ service: item.service, playlistId: item.servicePlaylistId }));

    try {
      const response = await fetch(rule ? `/api/sync-rules/${rule.id}` : "/api/sync-rules", {
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
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || `Could not save source route (${response.status})`);
        return;
      }

      router.push(rule ? `/settings?rule=${rule.id}` : "/settings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save source route.");
    } finally {
      setSaving(false);
    }
  }

  const writableDestinations = playlists.filter((playlist) => playlist.servicePlaylistId !== sourceId && playlist.isWritable);
  const destinationGroups = Array.from(
    writableDestinations.reduce((groups, playlist) => {
      const key = playlist.service.toUpperCase();
      const rows = groups.get(key) || [];
      rows.push(playlist);
      groups.set(key, rows);
      return groups;
    }, new Map<string, Playlist[]>()),
  ).sort(([a], [b]) => {
    const orderA = SERVICE_ORDER.indexOf(a);
    const orderB = SERVICE_ORDER.indexOf(b);
    if (orderA === -1 && orderB === -1) return a.localeCompare(b);
    if (orderA === -1) return 1;
    if (orderB === -1) return -1;
    return orderA - orderB;
  });
  const selectedDestinationCount = writableDestinations.filter((playlist) => destinationIds.has(playlist.servicePlaylistId)).length;

  return (
    <form onSubmit={submit} className="panel p-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white">{rule ? "Edit source route" : "New source route"}</h2>
        <p className="mt-2 text-sm text-muted-fg">
          Choose where changes are listened for, then choose which playlists should receive those changes.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Route name</span>
          <input
            name="name"
            defaultValue={rule?.name || "Music Bridge"}
            placeholder="e.g. Daily Mix bridge"
            className="w-full"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Listen for changes in</span>
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Apply changes to</div>
          {writableDestinations.length ? (
            <div className="pill">{selectedDestinationCount}/{writableDestinations.length} selected</div>
          ) : null}
        </div>
        <div className="space-y-3">
          {destinationGroups.map(([service, rows]) => {
            const meta = serviceMeta(service);
            const selected = rows.filter((playlist) => destinationIds.has(playlist.servicePlaylistId)).length;
            return (
              <section key={service} className={`rounded-xl border ${meta.border} bg-[var(--surface-2)]/35 p-3`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ServiceIcon service={service} size="sm" className="h-6 w-6 rounded-lg" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--text)]">{meta.label}</div>
                      <div className="text-[11px] text-muted-fg">
                        {selected}/{rows.length} destination{rows.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {rows.map((playlist) => {
                    const checked = destinationIds.has(playlist.servicePlaylistId);
                    return (
                      <label
                        key={playlist.id}
                        className={`group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition duration-200 ${
                          checked
                            ? `${meta.soft} shadow-[0_12px_28px_-26px_currentColor]`
                            : "border-white/5 bg-white/[0.02] text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-[var(--text)]"
                        }`}
                      >
                        <input
                          name="destinations"
                          type="checkbox"
                          value={playlist.servicePlaylistId}
                          defaultChecked={checked}
                          className="!h-4 !w-4 shrink-0 cursor-pointer accent-blue-500"
                        />
                        <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!writableDestinations.length ? (
            <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-sm text-muted-fg sm:col-span-2">
              No writable destination playlists are available yet. Connect another platform or refresh playlists first.
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">How strict</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full">
            <option value="ADD_ONLY">Add new songs only</option>
            <option value="ADD_AND_REMOVE">Add and remove songs</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Frequency</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full">
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end pb-1 text-xs font-bold text-slate-400">
          <span className="relative inline-block h-5 w-9 cursor-pointer">
            <input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} className="peer sr-only" />
            <span className="absolute inset-0 rounded-full bg-white/5 transition-colors peer-checked:bg-blue-600" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-400 transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
          </span>
          <span className="uppercase tracking-widest">Listen from this source</span>
        </label>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={saving} className="btn btn-primary mt-8 w-full">
        {saving ? "Saving..." : rule ? "Save source route" : "Create source route"}
      </button>
    </form>
  );
}
