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
        <h2 className="heading-section">{rule ? "Edit source route" : "New source route"}</h2>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-fg">
        Choose where changes are listened for, then choose which playlists should receive those changes.
      </p>

      <div className="mt-7 space-y-5">
        <label className="block space-y-2">
          <span className="field-label">Route name</span>
          <input
            name="name"
            defaultValue={rule?.name || "Music Bridge"}
            placeholder="e.g. Daily Mix bridge"
            className="w-full"
          />
        </label>

        <label className="block space-y-2">
          <span className="field-label">Listen for changes in</span>
          <select name="sourcePlaylistId" value={sourceId} onChange={(event) => changeSource(event.target.value)} className="w-full">
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
        </label>
        {selectedSource ? (
          <div className={`flex items-center gap-3 rounded-[var(--radius)] border ${serviceMeta(selectedSource.service).border} bg-[var(--surface-2)]/35 px-3 py-2.5`}>
            <ServiceIcon service={selectedSource.service} size="sm" className="h-7 w-7 rounded-[var(--radius-sm)]" />
            <div className="min-w-0">
              <div className="field-label">Current source</div>
              <div className="truncate text-sm font-semibold text-[var(--text)]">
                {serviceMeta(selectedSource.service).label} / {selectedSource.name}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="field-label">Apply changes to</div>
          {writableDestinations.length ? (
            <div className="pill">{selectedDestinationCount}/{writableDestinations.length} selected</div>
          ) : null}
        </div>
        <div className="space-y-6">
          {destinationGroups.map(([service, rows]) => {
            const meta = serviceMeta(service);
            const selected = rows.filter((playlist) => selectedDestinationIds.has(playlist.servicePlaylistId)).length;
            return (
              // Thirty-five framed checkboxes inside three framed sections was
              // the deepest nesting left in the app. The group keeps its brand
              // as a rule under its own header, and a destination is a plain
              // row: the checkbox is already the affordance, and the brand tint
              // is enough to show it is picked.
              <section key={service} className={`${meta.tint} min-w-0`}>
                <div className="service-border mb-1 flex items-center justify-between gap-3 border-b pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ServiceIcon service={service} size="sm" className="h-6 w-6 rounded-[var(--radius-sm)]" />
                    <div className="min-w-0">
                      <div className="heading-row">{meta.label}</div>
                      <div className="text-xs text-muted-fg">
                        {selected}/{rows.length} destination{rows.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2">
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
              </section>
            );
          })}
          {!writableDestinations.length ? (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-soft)] p-4 text-sm text-muted-fg sm:col-span-2">
              No writable destination playlists are available yet. Connect another platform or refresh playlists first.
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="field-label">How strict</span>
          <select name="mode" defaultValue={rule?.mode || "ADD_ONLY"} className="w-full">
            <option value="ADD_ONLY">Add new songs only</option>
            <option value="ADD_AND_REMOVE">Add and remove songs</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="field-label">Frequency</span>
          <select name="intervalMinutes" defaultValue={rule?.intervalMinutes || 60} className="w-full">
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end pb-1 text-xs font-medium text-muted-fg">
          <span className="relative inline-block h-5 w-9 cursor-pointer">
            <input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} className="peer sr-only" />
            <span className="absolute inset-0 rounded-full bg-[var(--surface-3)] transition-colors peer-checked:bg-accent" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--text-dim)] transition-transform peer-checked:translate-x-4 peer-checked:bg-[var(--text)]" />
          </span>
          <span className="">Listen from this source</span>
        </label>
      </div>

      {error ? (
        <div className="mt-6 rounded-[var(--radius-sm)] border border-danger/25 bg-danger/10 px-3 py-2 text-sm font-medium text-danger-fg">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={saving} className="btn btn-primary mt-8 w-full">
        {saving ? "Saving..." : rule ? "Save source route" : "Create source route"}
      </button>
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
