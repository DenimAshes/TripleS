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
  const [selectedDestinationIds, setSelectedDestinationIds] = useState(
    () => new Set(rule?.destinations.map((destination) => destination.playlistId) || []),
  );

  function changeSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    setSelectedDestinationIds((current) => {
      if (!current.has(nextSourceId)) return current;
      const next = new Set(current);
      next.delete(nextSourceId);
      return next;
    });
  }

  function toggleDestination(playlistId: string, checked: boolean) {
    setSelectedDestinationIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(playlistId);
      } else {
        next.delete(playlistId);
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const source = playlists.find((item) => item.servicePlaylistId === sourceId);
    const destinations = playlists
      .filter((item) => item.isWritable && selectedDestinationIds.has(item.servicePlaylistId) && item.servicePlaylistId !== sourceId)
      .map((item) => ({ service: item.service, playlistId: item.servicePlaylistId }));

    try {
      const response = await fetch(rule ? `/api/sync-rules/${rule.id}` : "/api/sync-rules", {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          sourceService: source?.service,
          sourcePlaylistId: sourceId,
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

  const sourceGroups = Array.from(
    playlists.reduce((groups, playlist) => {
      const key = playlist.service.toUpperCase();
      const rows = groups.get(key) || [];
      rows.push(playlist);
      groups.set(key, rows);
      return groups;
    }, new Map<string, Playlist[]>()),
  ).sort(([a], [b]) => compareServiceKeys(a, b));
  const selectedSource = playlists.find((playlist) => playlist.servicePlaylistId === sourceId);
  const writableDestinations = playlists.filter((playlist) => playlist.servicePlaylistId !== sourceId && playlist.isWritable);
  const destinationGroups = Array.from(
    writableDestinations.reduce((groups, playlist) => {
      const key = playlist.service.toUpperCase();
      const rows = groups.get(key) || [];
      rows.push(playlist);
      groups.set(key, rows);
      return groups;
    }, new Map<string, Playlist[]>()),
  ).sort(([a], [b]) => compareServiceKeys(a, b));
  const selectedDestinationCount = writableDestinations.filter((playlist) => selectedDestinationIds.has(playlist.servicePlaylistId)).length;

  return (
    <form onSubmit={submit} className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow text-muted-fg">{rule ? "Selected source" : "New automation"}</div>
          <h2 className="heading-section mt-1">{rule ? "Edit listening source" : "Create a listening source"}</h2>
        </div>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-fg">
        Choose where changes are listened for, then choose which playlists should receive those changes.
      </p>

      <div className="mt-7 space-y-5">
        <label className="block space-y-2">
          <span className="field-label">Route name</span>
          <input
            name="name"
            autoComplete="off"
            defaultValue={rule?.name || "Music Bridge"}
            placeholder="e.g. Daily Mix bridge"
            className="w-full"
          />
        </label>

        <label className="block space-y-2">
          <span className="field-label">Listen for changes in</span>
          <span className="flex items-center gap-3">
            {selectedSource ? <ServiceIcon service={selectedSource.service} size="sm" className="h-9 w-9" /> : null}
            <select name="sourcePlaylistId" value={sourceId} onChange={(event) => changeSource(event.target.value)} className="min-w-0 flex-1">
              {sourceGroups.map(([service, rows]) => (
                <optgroup key={service} label={serviceMeta(service).label}>
                  {rows.map((playlist) => (
                    <option key={playlist.id} value={playlist.servicePlaylistId}>
                      {playlist.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </span>
        </label>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="field-label">Apply changes to</div>
          {writableDestinations.length ? (
            <div className="pill">{selectedDestinationCount}/{writableDestinations.length} selected</div>
          ) : null}
        </div>
        <div className="space-y-2">
          {destinationGroups.map(([service, rows], index) => {
            const meta = serviceMeta(service);
            const selected = rows.filter((playlist) => selectedDestinationIds.has(playlist.servicePlaylistId)).length;
            return (
              <details key={service} open={selected > 0 || (!rule && index === 0)} className={`${meta.tint} group rounded-[var(--radius-sm)] border border-line-soft bg-surface-2/35`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 marker:content-none">
                  <div className="flex min-w-0 items-center gap-2">
                    <ServiceIcon service={service} size="sm" className="h-6 w-6 rounded-[var(--radius-sm)]" />
                    <div className="min-w-0">
                      <div className="heading-row">{meta.label}</div>
                      <div className="text-xs text-muted-fg">
                        {selected ? `${selected} selected` : `${rows.length} available`}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--accent)] group-open:hidden">Choose</span>
                  <span className="hidden text-xs text-muted-fg group-open:inline">Close</span>
                </summary>
                <div className="grid border-t border-line-soft p-2 sm:grid-cols-2">
                  {rows.map((playlist) => {
                    const checked = selectedDestinationIds.has(playlist.servicePlaylistId);
                    return (
                      <label
                        key={playlist.id}
                        className={`group flex min-w-0 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium transition duration-200 ${
                          checked
                            ? "bg-[color-mix(in_srgb,var(--service-glow,var(--accent))_14%,transparent)] text-[var(--text)]"
                            : "text-muted-fg hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                        }`}
                      >
                        <input
                          name="destinations"
                          type="checkbox"
                          value={playlist.servicePlaylistId}
                          checked={checked}
                          onChange={(event) => toggleDestination(playlist.servicePlaylistId, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {!writableDestinations.length ? (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-soft)] p-4 text-sm text-muted-fg sm:col-span-2">
              No writable destination playlists are available yet. Connect another platform or refresh playlists first.
            </div>
          ) : null}
        </div>
      </div>

      <details className="group mt-8 rounded-[var(--radius-sm)] border border-line-soft bg-surface-2/35">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-3 py-3 marker:content-none">
          <span>
            <span className="heading-row block">Schedule and behavior</span>
            <span className="mt-0.5 block text-xs text-muted-fg">{rule?.mode === "ADD_AND_REMOVE" ? "Add and remove" : "Add only"} · every {rule?.intervalMinutes || 60} minutes</span>
          </span>
          <span className="text-xs font-semibold text-[var(--accent)] group-open:hidden">Edit</span>
          <span className="hidden text-xs text-muted-fg group-open:inline">Close</span>
        </summary>
        <div className="grid gap-5 border-t border-line-soft p-3 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="field-label">When a song disappears</span>
            <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full">
              <option value="ADD_ONLY">Leave destination songs alone</option>
              <option value="ADD_AND_REMOVE">Remove songs TripleS added</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="field-label">Check for changes</span>
            <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full">
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-muted-fg sm:col-span-2">
            <span className="relative inline-block h-5 w-9 cursor-pointer">
              <input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} className="peer sr-only" />
              <span className="absolute inset-0 rounded-full bg-[var(--surface-3)] transition-colors peer-checked:bg-accent" />
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--text-dim)] transition-transform peer-checked:translate-x-4 peer-checked:bg-[var(--text)]" />
            </span>
            Keep listening to this source
          </label>
        </div>
      </details>

      {error ? (
        <div role="alert" className="mt-6 rounded-[var(--radius-sm)] border border-danger/25 bg-danger/10 px-3 py-2 text-sm font-medium text-danger-fg">
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex justify-end border-t border-line-soft pt-5">
        <button type="submit" disabled={saving} className="btn btn-primary w-full sm:w-auto sm:min-w-48">
          {saving ? "Saving…" : rule ? "Save changes" : "Create source"}
        </button>
      </div>
    </form>
  );
}

function compareServiceKeys(a: string, b: string) {
  const orderA = SERVICE_ORDER.indexOf(a);
  const orderB = SERVICE_ORDER.indexOf(b);
  if (orderA === -1 && orderB === -1) return a.localeCompare(b);
  if (orderA === -1) return 1;
  if (orderB === -1) return -1;
  return orderA - orderB;
}
