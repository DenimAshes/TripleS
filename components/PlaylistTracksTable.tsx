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
  const [pending, startTransition] = useTransition();
  const [excludedByTrack, setExcludedByTrack] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tracks;
    return tracks.filter((track) => `${track.title} ${track.artists} ${track.album || ""}`.toLowerCase().includes(needle));
  }, [query, tracks]);

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
    <div className="space-y-3">
      <label className="flex max-w-md items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-ring)] transition">
        <Search size={16} className="text-dim-fg" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a song"
          className="w-full !border-0 !bg-transparent !p-0 !shadow-none focus:!shadow-none"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-fg">No songs found.</div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-[10px] uppercase tracking-[0.15em] text-dim-fg">
              <tr>
                <th className="w-12 px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Song</th>
                <th className="hidden px-3 py-2.5 lg:table-cell">Connected</th>
                <th className="hidden px-3 py-2.5 md:table-cell">Album</th>
                <th className="w-16 px-3 py-2.5">Time</th>
                <th className="w-10 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((track) => (
                <tr key={track.id} className="border-t border-[var(--border-soft)] transition hover:bg-[var(--surface-2)]/60">
                  <td className="px-3 py-2.5 text-dim-fg tabular-nums">{track.position}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {track.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={track.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-md bg-[var(--surface-2)]" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{track.title}</div>
                        <div className="truncate text-xs text-muted-fg">{track.artists}</div>
                        {isExcluded(track) ? (
                          <div className="mt-1 text-xs font-medium text-[#fcd34d]">Only in this playlist</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
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
                            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)] transition hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] hover:bg-[var(--surface-hover)]"
                          >
                            Change match
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExcluded(track)}
                            disabled={pending}
                            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)] transition hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] hover:bg-[var(--surface-hover)]"
                          >
                            {isExcluded(track) ? "Sync this song" : "Keep only here"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-muted-fg md:table-cell">{track.album || "-"}</td>
                  <td className="px-3 py-2.5 text-muted-fg tabular-nums">{formatDuration(track.durationMs)}</td>
                  <td className="px-3 py-2.5">
                    {track.url ? (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-dim-fg transition hover:text-[var(--accent)]"
                        aria-label={`Open on ${service}`}
                      >
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
