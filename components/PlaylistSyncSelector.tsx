"use client";

import type { SyncDestination, SyncRule } from "@prisma/client";
import { Check, ListMusic, Save } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type PlaylistOption = {
  id: string;
  service: string;
  servicePlaylistId: string;
  name: string;
  description: string | null;
  trackCount: number;
  isWritable: boolean;
};

type RuleWithDestinations = Pick<
  SyncRule,
  "id" | "name" | "sourceService" | "sourcePlaylistId" | "mode" | "intervalMinutes" | "isEnabled"
> & {
  destinations: Pick<SyncDestination, "service" | "playlistId" | "isEnabled">[];
};

const services = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];

export function PlaylistSyncSelector({
  playlists,
  rule,
}: {
  playlists: PlaylistOption[];
  rule?: RuleWithDestinations;
}) {
  const router = useRouter();
  const [activeService, setActiveService] = useState(rule?.sourceService || "SPOTIFY");
  const [sourcePlaylistId, setSourcePlaylistId] = useState(rule?.sourcePlaylistId || playlists[0]?.servicePlaylistId || "");
  const [destinationIds, setDestinationIds] = useState(
    () => new Set(rule?.destinations.filter((item) => item.isEnabled).map((item) => item.playlistId) || []),
  );
  const [saving, setSaving] = useState(false);

  const sourcePlaylist = playlists.find((playlist) => playlist.servicePlaylistId === sourcePlaylistId);
  const activePlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.service === activeService),
    [activeService, playlists],
  );

  function selectSource(playlist: PlaylistOption) {
    setSourcePlaylistId(playlist.servicePlaylistId);
    setDestinationIds((current) => {
      const next = new Set(current);
      next.delete(playlist.servicePlaylistId);
      return next;
    });
  }

  function toggleDestination(playlist: PlaylistOption) {
    setDestinationIds((current) => {
      const next = new Set(current);
      if (next.has(playlist.servicePlaylistId)) {
        next.delete(playlist.servicePlaylistId);
      } else {
        next.add(playlist.servicePlaylistId);
      }
      return next;
    });
  }

  async function save() {
    const source = playlists.find((playlist) => playlist.servicePlaylistId === sourcePlaylistId);
    if (!source) return;

    setSaving(true);
    const destinations = playlists
      .filter((playlist) => destinationIds.has(playlist.servicePlaylistId) && playlist.servicePlaylistId !== sourcePlaylistId)
      .map((playlist) => ({ service: playlist.service, playlistId: playlist.servicePlaylistId }));

    const response = await fetch(rule ? `/api/sync-rules/${rule.id}` : "/api/sync-rules", {
      method: rule ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
            name: rule?.name || `${source.service} playlist selection`,
        sourceService: source.service,
        sourcePlaylistId: source.servicePlaylistId,
        mode: rule?.mode || "ADD_ONLY",
        intervalMinutes: rule?.intervalMinutes ?? 60,
        isEnabled: rule?.isEnabled ?? true,
        destinations,
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (payload.rule?.id) {
      router.push(`/playlists?rule=${payload.rule.id}`);
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{rule ? rule.name : "New selection"}</h2>
          <p className="mt-1 text-sm text-muted-fg">
            Main:{" "}
            <span className="text-[var(--text)]">
              {sourcePlaylist ? `${sourcePlaylist.service} · ${sourcePlaylist.name}` : "not selected"}
            </span>
            <span className="mx-2 text-dim-fg">·</span>
            <span className="tabular-nums">{destinationIds.size}</span> {destinationIds.size === 1 ? "copy" : "copies"}
          </p>
        </div>
        <button type="button" onClick={save} disabled={saving || !sourcePlaylistId} className="btn btn-primary">
          <Save size={16} /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {services.map((service) => {
          const active = activeService === service;
          return (
            <button
              type="button"
              key={service}
              onClick={() => setActiveService(service)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)]"
                  : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              {service}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {activePlaylists.map((playlist) => {
          const isSource = playlist.servicePlaylistId === sourcePlaylistId;
          const isDestination = destinationIds.has(playlist.servicePlaylistId);
          const highlight = isSource || isDestination;
          return (
            <div
              key={playlist.id}
              className={`panel p-4 transition ${
                highlight
                  ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                  : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{playlist.name}</h3>
                  <p className="mt-1 truncate text-sm text-muted-fg">{playlist.description || "No description"}</p>
                  <p className="mt-2 text-xs text-dim-fg">
                    <span className="tabular-nums">{playlist.trackCount}</span> tracks
                  </p>
                </div>
                {highlight ? <Check className="shrink-0 text-[var(--accent)]" size={18} /> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectSource(playlist)}
                  className={isSource ? "btn btn-primary" : "btn btn-ghost"}
                >
                  Main
                </button>
                <button
                  type="button"
                  onClick={() => toggleDestination(playlist)}
                  disabled={isSource || !playlist.isWritable}
                  className={
                    isDestination
                      ? "btn bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60"
                      : "btn btn-ghost"
                  }
                >
                  {isDestination ? "Copying" : "Copy to"}
                </button>
                <Link href={`/playlists/${playlist.id}`} className="btn btn-ghost">
                  <ListMusic size={14} /> Songs
                </Link>
              </div>
            </div>
          );
        })}
        {!activePlaylists.length ? (
          <div className="panel p-5 text-sm text-muted-fg md:col-span-2">No playlists on this platform yet.</div>
        ) : null}
      </div>
    </div>
  );
}
