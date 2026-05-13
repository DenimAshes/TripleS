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
      <div className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{rule ? rule.name : "New selection"}</h2>
          <p className="mt-1 text-sm text-[#666a73]">
            Main playlist: {sourcePlaylist ? `${sourcePlaylist.service}: ${sourcePlaylist.name}` : "not selected"} / copies: {destinationIds.size}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !sourcePlaylistId}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[#18181b] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          <Save size={16} /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {services.map((service) => (
          <button
            type="button"
            key={service}
            onClick={() => setActiveService(service)}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              activeService === service ? "border-[#18181b] bg-[#18181b] text-white" : "border-[#deded8] bg-white"
            }`}
          >
            {service}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {activePlaylists.map((playlist) => {
          const isSource = playlist.servicePlaylistId === sourcePlaylistId;
          const isDestination = destinationIds.has(playlist.servicePlaylistId);
          return (
            <div key={playlist.id} className={`panel p-4 ${isSource ? "border-[#18181b]" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{playlist.name}</h3>
                  <p className="mt-1 text-sm text-[#666a73]">{playlist.description || "No description"}</p>
                  <p className="mt-2 text-xs text-[#666a73]">{playlist.trackCount} tracks</p>
                </div>
                {isSource || isDestination ? <Check className="shrink-0" size={18} /> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectSource(playlist)}
                  className={`rounded-md px-3 py-2 text-sm ${
                    isSource ? "bg-[#18181b] text-white" : "border border-[#deded8] bg-white"
                  }`}
                >
                  Main
                </button>
                <button
                  type="button"
                  onClick={() => toggleDestination(playlist)}
                  disabled={isSource || !playlist.isWritable}
                  className={`rounded-md px-3 py-2 text-sm disabled:opacity-50 ${
                    isDestination ? "bg-emerald-700 text-white" : "border border-[#deded8] bg-white"
                  }`}
                >
                  Copy to
                </button>
                <Link
                  href={`/playlists/${playlist.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm"
                >
                  <ListMusic size={14} /> Songs
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
