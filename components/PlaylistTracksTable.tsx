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
      <label className="flex max-w-md items-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm">
        <Search size={16} className="text-[#666a73]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a song"
          className="w-full bg-transparent outline-none"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="panel p-6 text-sm text-[#666a73]">No songs found.</div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f0ec] text-left text-xs uppercase tracking-wide text-[#666a73]">
              <tr>
                <th className="w-12 px-3 py-2">#</th>
                <th className="px-3 py-2">Song</th>
                <th className="hidden px-3 py-2 lg:table-cell">Connected</th>
                <th className="hidden px-3 py-2 md:table-cell">Album</th>
                <th className="w-16 px-3 py-2">Time</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((track) => (
                <tr key={track.id} className="border-t border-[#deded8]">
                  <td className="px-3 py-2 text-[#666a73]">{track.position}</td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {track.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={track.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-[#f0f0ec]" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{track.title}</div>
                        <div className="truncate text-xs text-[#666a73]">{track.artists}</div>
                        {isExcluded(track) ? (
                          <div className="mt-1 text-xs font-medium text-[#8a5a00]">Only in this playlist</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {(track.linkedServices || []).map((linkedService) => (
                        <span key={linkedService} className="rounded bg-[#e8f3ec] px-2 py-1 text-xs text-[#235c36]">
                          {SERVICE_LABELS[linkedService] || linkedService}
                        </span>
                      ))}
                      {(track.missingServices || []).map((missingService) => (
                        <span key={missingService} className="rounded bg-[#f2eee5] px-2 py-1 text-xs text-[#7a5a1f]">
                          Choose {SERVICE_LABELS[missingService] || missingService}
                        </span>
                      ))}
                      {track.groupId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => changeMatch(track)}
                            disabled={pending}
                            className="rounded border border-[#deded8] bg-white px-2 py-1 text-xs text-[#333] hover:bg-[#f0f0ec]"
                          >
                            Change match
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExcluded(track)}
                            disabled={pending}
                            className="rounded border border-[#deded8] bg-white px-2 py-1 text-xs text-[#333] hover:bg-[#f0f0ec]"
                          >
                            {isExcluded(track) ? "Sync this song" : "Keep only here"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 text-[#666a73] md:table-cell">{track.album || "-"}</td>
                  <td className="px-3 py-2 text-[#666a73]">{formatDuration(track.durationMs)}</td>
                  <td className="px-3 py-2">
                    {track.url ? (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#666a73] hover:text-[#18181b]"
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
