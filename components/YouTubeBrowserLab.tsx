"use client";

import { AlertCircle, CheckCircle2, CirclePlay, ExternalLink, Loader2, Music2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
};

type Track = {
  title: string;
  artists: string[];
  durationMs?: number;
  sourceTrackId: string;
  url?: string;
  imageUrl?: string;
};

type PlaylistsSnapshot = {
  playlists: Playlist[];
  lastSyncedAt: string | null;
  fromCache: boolean;
  isStale: boolean;
};

type AddResponse = {
  ok: boolean;
  added: boolean;
  duplicate?: Track;
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatDuration(durationMs?: number) {
  if (!durationMs) return "";
  const total = Math.round(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

type PlaylistsResponse = PlaylistsSnapshot;
type TracksResponse = { tracks: Track[]; lastFetchedAt: string | null; fromCache: boolean; isStale: boolean };
type TrackSnapshot = TracksResponse;
type TrackRefreshJob = {
  id: string;
  playlistId: string;
  status: "running" | "completed" | "failed";
  tracks: Track[];
  lastFetchedAt: string | null;
  error: string | null;
};

function formatRelative(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function YouTubeBrowserLab({ initialPlaylists }: { initialPlaylists: PlaylistsSnapshot }) {
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists.playlists);
  const [selectedId, setSelectedId] = useState(initialPlaylists.playlists[0]?.id || "");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksMeta, setTracksMeta] = useState<{ lastFetchedAt: string | null; fromCache: boolean; isStale: boolean }>({
    lastFetchedAt: null,
    fromCache: false,
    isStale: true,
  });
  const [tracksByPlaylist, setTracksByPlaylist] = useState<Record<string, TrackSnapshot>>({});
  const [playlistsMeta, setPlaylistsMeta] = useState<{ lastSyncedAt: string | null; fromCache: boolean; isStale: boolean }>({
    lastSyncedAt: initialPlaylists.lastSyncedAt,
    fromCache: initialPlaylists.fromCache,
    isStale: initialPlaylists.isStale,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedIdRef = useRef(selectedId);
  const backgroundRefreshRef = useRef(new Set<string>());

  const selectedPlaylist = useMemo(() => playlists.find((playlist) => playlist.id === selectedId), [playlists, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  async function loadPlaylists(force = false) {
    setBusy("playlists");
    setBusyLabel(force ? "Updating playlists..." : "Loading playlists...");
    setError("");
    setNotice("");
    try {
      const data = await readJson<PlaylistsResponse>(`/api/youtube-browser/playlists${force ? "?refresh=1" : ""}`);
      setPlaylists(data.playlists);
      setPlaylistsMeta({ lastSyncedAt: data.lastSyncedAt, fromCache: data.fromCache, isStale: data.isStale });
      const nextId = selectedId || data.playlists[0]?.id || "";
      setSelectedId(nextId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load playlists";
      setError(message);
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function loadTracks(playlistId = selectedId, force = false) {
    if (!playlistId) return;
    const cached = tracksByPlaylist[playlistId];
    if (!force && cached) {
      setTracks(cached.tracks);
      setTracksMeta({ lastFetchedAt: cached.lastFetchedAt, fromCache: cached.fromCache, isStale: cached.isStale });
      return;
    }

    setBusy("tracks");
    setBusyLabel(force ? "Updating tracks..." : "Loading tracks...");
    setError("");
    try {
      const data = await readJson<TracksResponse>(`/api/youtube-browser/tracks?playlistId=${encodeURIComponent(playlistId)}${force ? "&refresh=1" : ""}`);
      setTracks(data.tracks);
      setTracksMeta({ lastFetchedAt: data.lastFetchedAt, fromCache: data.fromCache, isStale: data.isStale });
      setTracksByPlaylist((current) => ({ ...current, [playlistId]: data }));
      const playlist = playlists.find((item) => item.id === playlistId);
      if (!force && data.tracks.length === 0 && data.isStale && playlist && playlist.trackCount > 0) {
        void syncTracksInBackground(playlistId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load tracks";
      setError(message);
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function syncTracksInBackground(playlistId: string) {
    if (backgroundRefreshRef.current.has(playlistId)) return;
    backgroundRefreshRef.current.add(playlistId);

    try {
      const started = await readJson<{ job: TrackRefreshJob }>("/api/youtube-browser/tracks/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId }),
      });
      await pollTrackRefreshJob(playlistId, started.job.id);
    } catch {
      backgroundRefreshRef.current.delete(playlistId);
    }
  }

  async function pollTrackRefreshJob(playlistId: string, jobId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const data = await readJson<{ job: TrackRefreshJob | null }>(`/api/youtube-browser/tracks/refresh?playlistId=${encodeURIComponent(playlistId)}`);
      const job = data.job;
      if (!job || job.id !== jobId || job.status === "running") continue;

      backgroundRefreshRef.current.delete(playlistId);
      if (job.status === "failed") {
        return;
      }

      const snapshot: TrackSnapshot = {
        tracks: job.tracks,
        lastFetchedAt: job.lastFetchedAt,
        fromCache: false,
        isStale: false,
      };
      setTracksByPlaylist((current) => ({ ...current, [playlistId]: snapshot }));
      if (selectedIdRef.current === playlistId) {
        setTracks(snapshot.tracks);
        setTracksMeta({ lastFetchedAt: snapshot.lastFetchedAt, fromCache: snapshot.fromCache, isStale: snapshot.isStale });
      }
      return;
    }

    backgroundRefreshRef.current.delete(playlistId);
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setBusy("search");
    setBusyLabel("Searching...");
    setError("");
    setNotice("");
    try {
      const data = await readJson<{ tracks: Track[] }>(`/api/youtube-browser/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(data.tracks.slice(0, 8));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not search YouTube Music";
      setError(message);
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function addTrack(query: string) {
    if (!selectedId) return;
    setBusy(`add:${query}`);
    setBusyLabel("Adding track...");
    setError("");
    setNotice("");
    try {
      const result = await readJson<AddResponse>("/api/youtube-browser/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: selectedId, query }),
      });
      setNotice(result.added ? "Track added" : `Already in playlist: ${result.duplicate?.title || query}`);
      setTracksByPlaylist((current) => {
        const next = { ...current };
        delete next[selectedId];
        return next;
      });
      await loadTracks(selectedId, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add track";
      setError(message);
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function removeTrack(track: Track) {
    if (!selectedId) return;
    setBusy(`remove:${track.sourceTrackId}`);
    setBusyLabel("Removing track...");
    setError("");
    setNotice("");
    try {
      await readJson("/api/youtube-browser/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: selectedId, trackText: track.sourceTrackId }),
      });
      setNotice("Track removed");
      setTracksByPlaylist((current) => {
        const next = { ...current };
        delete next[selectedId];
        return next;
      });
      await loadTracks(selectedId, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not remove track";
      setError(message);
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  useEffect(() => {
    if (initialPlaylists.playlists.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[#deded8] p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-md bg-[#121212] text-white">
              <CirclePlay size={22} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">YouTube Music</h2>
              <p className="mt-1 text-sm text-[#666a73]">Manage your YouTube Music playlists.</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => loadPlaylists(true)}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f0f0ec] disabled:opacity-60"
            >
              <RefreshCw size={16} className={busy === "playlists" ? "animate-spin" : ""} />
              Refresh
            </button>
            {playlistsMeta.lastSyncedAt ? <span className="text-xs text-[#666a73]">Updated {formatRelative(playlistsMeta.lastSyncedAt)}</span> : null}
          </div>
        </div>

        {error ? (
          <div className="m-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="m-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        ) : null}

        {busyLabel ? (
          <div className="m-4 flex items-center gap-2 rounded-md border border-[#deded8] bg-[#f7f7f4] p-3 text-sm text-[#444852]">
            <Loader2 size={16} className="animate-spin" />
            <span>{busyLabel}</span>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-[#deded8] px-4 py-3">
            <h2 className="font-semibold">Playlists</h2>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-2">
            {busy === "playlists" && playlists.length === 0 ? <LoadingRow label="Loading playlists" /> : null}
            {!busy && playlists.length === 0 ? <EmptyRow label="No playlists loaded yet" /> : null}
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => {
                  setSelectedId(playlist.id);
                  const snapshot = tracksByPlaylist[playlist.id];
                  setTracks(snapshot?.tracks || []);
                  setTracksMeta({
                    lastFetchedAt: snapshot?.lastFetchedAt || null,
                    fromCache: snapshot?.fromCache || false,
                    isStale: snapshot?.isStale ?? true,
                  });
                  loadTracks(playlist.id);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-[#f0f0ec] ${selectedId === playlist.id ? "bg-[#ecece6]" : ""}`}
              >
                <div
                  className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[#e5e5df] bg-cover bg-center text-xs font-semibold text-[#666a73]"
                  style={playlist.imageUrl ? { backgroundImage: `url(${playlist.imageUrl})` } : undefined}
                >
                  {playlist.imageUrl ? null : playlist.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{playlist.name}</div>
                  <div className="text-xs text-[#666a73]">{playlist.trackCount} tracks</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div className="panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[#deded8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">{selectedPlaylist?.name || "Select playlist"}</h2>
                <div className="text-sm text-[#666a73]">
                  {tracks.length} tracks
                  {selectedId && tracksMeta.lastFetchedAt ? ` · updated ${formatRelative(tracksMeta.lastFetchedAt)}` : ""}
                </div>
              </div>
              <button
                onClick={() => loadTracks(selectedId, true)}
                disabled={!selectedId || busy !== null}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm hover:bg-[#f0f0ec] disabled:opacity-60"
              >
                <RefreshCw size={16} className={busy === "tracks" ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
            <div className="divide-y divide-[#eeeeea]">
              {busy === "tracks" && tracks.length === 0 ? <LoadingRow label="Loading tracks" /> : null}
              {!busy && selectedId && tracks.length === 0 ? <EmptyRow label="No tracks to show yet. Press Refresh to load this playlist." /> : null}
              {tracks.map((track) => {
                const ytUrl = track.url || `https://music.youtube.com/watch?v=${track.sourceTrackId}`;
                return (
                  <div key={track.sourceTrackId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3">
                    <div
                      className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[#e5e5df] bg-cover bg-center text-[#666a73]"
                      style={track.imageUrl ? { backgroundImage: `url(${track.imageUrl})` } : undefined}
                    >
                      {track.imageUrl ? null : <Music2 size={16} />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{track.title}</div>
                      <div className="truncate text-xs text-[#666a73]">
                        {track.artists.join(", ")} {formatDuration(track.durationMs) ? `· ${formatDuration(track.durationMs)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={ytUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in YouTube Music"
                        className="grid size-9 place-items-center rounded-md border border-[#deded8] bg-white text-[#666a73] hover:bg-[#f0f0ec] hover:text-[#171717]"
                      >
                        <ExternalLink size={16} />
                      </a>
                      <button
                        onClick={() => removeTrack(track)}
                        disabled={busy !== null}
                        title="Remove"
                        className="grid size-9 place-items-center rounded-md border border-[#deded8] bg-white text-[#666a73] hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                      >
                        {busy === `remove:${track.sourceTrackId}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel overflow-hidden">
            <form onSubmit={search} className="flex flex-col gap-3 border-b border-[#deded8] p-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#666a73]" size={16} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Artist - Track"
                  className="h-10 w-full rounded-md border border-[#deded8] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#171717]"
                />
              </div>
              <button
                disabled={busy !== null || !searchQuery.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#171717] px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy === "search" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Search
              </button>
            </form>
            <div className="divide-y divide-[#eeeeea]">
              {!busy && searchQuery && searchResults.length === 0 ? <EmptyRow label="No search results loaded" /> : null}
              {searchResults.map((track) => {
                const query = `${track.artists[0] || ""} ${track.title}`.trim();
                const ytUrl = track.url || `https://music.youtube.com/watch?v=${track.sourceTrackId}`;
                return (
                  <div key={track.sourceTrackId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3">
                    <div
                      className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[#e5e5df] bg-cover bg-center text-[#666a73]"
                      style={track.imageUrl ? { backgroundImage: `url(${track.imageUrl})` } : undefined}
                    >
                      {track.imageUrl ? null : <Music2 size={16} />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{track.title}</div>
                      <div className="truncate text-xs text-[#666a73]">{track.artists.join(", ")}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={ytUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in YouTube Music"
                        className="grid size-9 place-items-center rounded-md border border-[#deded8] bg-white text-[#666a73] hover:bg-[#f0f0ec] hover:text-[#171717]"
                      >
                        <ExternalLink size={16} />
                      </a>
                      <button
                        onClick={() => addTrack(query)}
                        disabled={!selectedId || busy !== null}
                        title="Add"
                        className="grid size-9 place-items-center rounded-md border border-[#deded8] bg-white text-[#666a73] hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-60"
                      >
                        {busy === `add:${query}` ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-[#666a73]">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="p-4 text-sm text-[#666a73]">{label}</div>;
}
