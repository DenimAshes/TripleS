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
    <div className="space-y-5">
      <div className="panel flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-[var(--text)]">{rule ? rule.name : "Create new sync"}</h2>
          <p className="mt-2 text-sm text-muted-fg">
            Main:{" "}
            <span className="font-semibold text-[var(--accent)]">
              {sourcePlaylist ? `${sourcePlaylist.service} · ${sourcePlaylist.name}` : "not selected"}
            </span>
            <span className="mx-2 text-dim-fg">·</span>
            <span className="tabular-nums font-semibold text-[var(--text)]">{destinationIds.size}</span> <span className="text-muted-fg">{destinationIds.size === 1 ? "copy" : "copies"}</span>
          </p>
        </div>
        <button type="button" onClick={save} disabled={saving || !sourcePlaylistId} className="btn btn-primary whitespace-nowrap">
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
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition duration-200 ${
                active
                  ? "border-[var(--border-accent)] bg-gradient-to-r from-[var(--accent-soft)] to-transparent text-[var(--text)]"
                  : "border-[var(--border-soft)] bg-[var(--surface-2)] text-muted-fg hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }`}
              onClick={() => setActiveService(service)}
            >
              {service}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {activePlaylists.map((playlist) => {
          const isSource = playlist.servicePlaylistId === sourcePlaylistId;
          const isDestination = destinationIds.has(playlist.servicePlaylistId);
          const highlight = isSource || isDestination;
          return (
            <div
              key={playlist.id}
              className={`panel p-5 transition duration-200 ${
                highlight
                  ? "border-[var(--border-accent)] shadow-[0_0_20px_rgba(79,141,255,0.1)]"
                  : "hover:border-[var(--border)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-[var(--text)]">{playlist.name}</h3>
                  <p className="mt-1 truncate text-sm text-muted-fg">{playlist.description || "No description"}</p>
                  <p className="mt-2.5 text-xs font-medium text-dim-fg">
                    <span className="tabular-nums">{playlist.trackCount}</span> tracks
                  </p>
                </div>
                {highlight ? <Check className="shrink-0 text-[var(--accent)]" size={20} strokeWidth={2.5} /> : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
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
