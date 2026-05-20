"use client";

import { ExternalLink, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

export type PlaylistTrackRow = {
  id: string;
  position: number;
  title: string;
  artists: string;
  album: string | null;
  durationMs: number | null;
  imageUrl: string | null;
  url: string | null;
  playlistId?: string;
  serviceTrackId?: string;
  groupId?: string;
  linkedServices?: string[];
  missingServices?: string[];
  isExcluded?: boolean;
};

const SERVICE_LABELS: Record<string, string> = {
  SPOTIFY: "Spotify",
  YOUTUBE: "YouTube Music",
  SOUNDCLOUD: "SoundCloud",
};
const INITIAL_VISIBLE_TRACKS = 100;
const LOAD_MORE_TRACKS = 100;

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PlaylistTracksTable({ tracks, service }: { tracks: PlaylistTrackRow[]; service: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [visibleState, setVisibleState] = useState({ key: "", count: INITIAL_VISIBLE_TRACKS });
  const [pending, startTransition] = useTransition();
  const [excludedByTrack, setExcludedByTrack] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tracks;
    return tracks.filter((track) => `${track.title} ${track.artists} ${track.album || ""}`.toLowerCase().includes(needle));
  }, [query, tracks]);
  const visibleKey = `${query}\0${tracks.length}`;
  const visibleCount = visibleState.key === visibleKey ? visibleState.count : INITIAL_VISIBLE_TRACKS;
  const visibleTracks = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remainingCount = Math.max(0, filtered.length - visibleTracks.length);

  function isExcluded(track: PlaylistTrackRow) {
    return excludedByTrack[track.id] ?? Boolean(track.isExcluded);
  }

  async function toggleExcluded(track: PlaylistTrackRow) {
    if (!track.groupId || !track.playlistId || !track.serviceTrackId) return;
    const nextExcluded = !isExcluded(track);
    setExcludedByTrack((current) => ({ ...current, [track.id]: nextExcluded }));
    const response = await fetch(`/api/playlist-groups/${track.groupId}/exclude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playlistId: track.playlistId,
        serviceTrackId: track.serviceTrackId,
        excluded: nextExcluded,
      }),
    });
    if (!response.ok) {
      setExcludedByTrack((current) => ({ ...current, [track.id]: !nextExcluded }));
      return;
    }
    startTransition(() => router.refresh());
  }

  async function changeMatch(track: PlaylistTrackRow) {
    if (!track.groupId || !track.serviceTrackId) return;
    const services = Array.from(new Set([...(track.missingServices || []), ...(track.linkedServices || [])]));
    const targetService =
      services.length === 1
        ? services[0]
        : window.prompt(`Platform: ${services.map((item) => SERVICE_LABELS[item] || item).join(", ")}`, services[0] || "");
    if (!targetService) return;
    const url = window.prompt(`Paste the song link for ${SERVICE_LABELS[targetService] || targetService}`);
    if (!url) return;

    const response = await fetch(`/api/playlist-groups/${track.groupId}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceTrackId: track.serviceTrackId,
        targetService,
        url,
      }),
    });
    if (response.ok) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex max-w-md items-center gap-3 rounded-2xl border border-white/5 bg-[#0d0e12]/60 px-5 py-3 text-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_20px_rgba(59,130,246,0.1)]">
        <Search size={18} className="shrink-0 text-blue-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter data stream..."
          className="w-full border-0! bg-transparent! p-0! text-sm font-bold text-white shadow-none! placeholder:text-slate-700 focus:shadow-none!"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="panel text-muted-fg p-8 text-center text-sm">No songs found.</div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-dim-fg border-b border-[var(--border-soft)] bg-gradient-to-r from-[var(--surface-2)] to-transparent text-left text-xs font-semibold tracking-widest uppercase">
              <tr>
                <th className="w-12 px-4 py-3.5 font-semibold">#</th>
                <th className="px-4 py-3.5 font-semibold">Song</th>
                <th className="hidden px-4 py-3.5 font-semibold lg:table-cell">Connected</th>
                <th className="hidden px-4 py-3.5 font-semibold md:table-cell">Album</th>
                <th className="w-16 px-4 py-3.5 font-semibold">Time</th>
                <th className="w-10 px-4 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)]">
              {visibleTracks.map((track, index) => (
                <tr key={track.id} className="transition duration-200 hover:bg-[var(--surface-2)]/40">
                  <td className="text-dim-fg px-4 py-3.5 font-medium tabular-nums">{track.position}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {track.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          loading={index < 20 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-10 w-10 shrink-0 rounded-lg border border-[var(--border-soft)] object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-lg border border-[var(--border-soft)] bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface-3)]" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--text)]">{track.title}</div>
                        <div className="text-muted-fg truncate text-xs">{track.artists}</div>
                        {isExcluded(track) ? (
                          <div className="mt-1 text-xs font-medium text-[#fcd34d]">Only in this playlist</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3.5 lg:table-cell">
                    <div className="flex max-w-xs flex-wrap gap-1.5">
                      {(track.linkedServices || []).map((linkedService) => (
                        <span key={linkedService} className="pill pill-success">
                          {SERVICE_LABELS[linkedService] || linkedService}
                        </span>
                      ))}
                      {(track.missingServices || []).map((missingService) => (
                        <span key={missingService} className="pill pill-warning normal-case">
                          + {SERVICE_LABELS[missingService] || missingService}
                        </span>
                      ))}
                      {track.groupId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => changeMatch(track)}
                            disabled={pending}
                            className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-r hover:from-[var(--accent-soft)] hover:to-transparent"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExcluded(track)}
                            disabled={pending}
                            className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-r hover:from-[var(--accent-soft)] hover:to-transparent"
                          >
                            {isExcluded(track) ? "Sync" : "Keep"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-muted-fg hidden px-4 py-3.5 md:table-cell">{track.album || "-"}</td>
                  <td className="text-muted-fg px-4 py-3.5 tabular-nums">{formatDuration(track.durationMs)}</td>
                  <td className="px-4 py-3.5">
                    {track.url ? (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-dim-fg transition duration-200 hover:text-[var(--accent)]"
                        aria-label={`Open on ${service}`}
                      >
                        <ExternalLink size={16} />
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {remainingCount > 0 ? (
            <div className="border-t border-[var(--border-soft)] bg-[#0d0e12]/50 p-4 text-center">
              <button
                type="button"
                onClick={() =>
                  setVisibleState((current) => ({
                    key: visibleKey,
                    count: (current.key === visibleKey ? current.count : INITIAL_VISIBLE_TRACKS) + LOAD_MORE_TRACKS,
                  }))
                }
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-accent)]"
              >
                Load {Math.min(LOAD_MORE_TRACKS, remainingCount)} more
                <span className="ml-2 text-xs font-normal text-muted-fg">{remainingCount} hidden</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
