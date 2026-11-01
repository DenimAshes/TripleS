"use client";

import { CheckCircle2, ExternalLink, ListMusic, Loader2, Music2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Callout } from "./Callout";

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

type SessionStatus = {
  hasState: boolean;
  isBrowserAutomationEnabled: boolean;
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

function formatRelative(iso: string | null, nowMs: number) {
  if (!iso) return "never";
  const diff = nowMs - new Date(iso).getTime();
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
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [workspaceView, setWorkspaceView] = useState<"tracks" | "search">("tracks");
  const [busy, setBusy] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nowMs] = useState(() => Date.now());
  // Without this the page just showed empty panels when browser automation was
  // off or no session had been uploaded — the API knew why, nothing asked it.
  const [session, setSession] = useState<SessionStatus | null>(null);
  const selectedIdRef = useRef(selectedId);
  const backgroundRefreshRef = useRef(new Set<string>());

  const selectedPlaylist = useMemo(() => playlists.find((playlist) => playlist.id === selectedId), [playlists, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  async function loadPlaylists(force = false) {
    setBusy("playlists");
    setBusyLabel(force ? "Updating playlists…" : "Loading playlists…");
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
    setBusyLabel(force ? "Updating tracks…" : "Loading tracks…");
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

  async function createPlaylist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    setBusy("create-playlist");
    setBusyLabel("Creating private playlist…");
    setError("");
    setNotice("");
    try {
      const data = await readJson<{ playlist: Playlist }>("/api/youtube-browser/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setPlaylists((current) =>
        [...current.filter((playlist) => playlist.id !== data.playlist.id), data.playlist].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setSelectedId(data.playlist.id);
      setTracks([]);
      setTracksMeta({ lastFetchedAt: null, fromCache: false, isStale: true });
      setPlaylistsMeta({ lastSyncedAt: new Date().toISOString(), fromCache: false, isStale: false });
      setNewPlaylistName("");
      setWorkspaceView("tracks");
      setNotice(`Playlist ready: ${data.playlist.name}`);
      if (data.playlist.trackCount > 0) await loadTracks(data.playlist.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function deleteSelectedPlaylist() {
    if (!selectedPlaylist) return;
    if (!window.confirm(`Delete “${selectedPlaylist.name}” permanently from YouTube Music?`)) return;
    setBusy("delete-playlist");
    setBusyLabel("Deleting playlist…");
    setError("");
    setNotice("");
    try {
      await readJson("/api/youtube-browser/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: selectedPlaylist.id }),
      });
      const remaining = playlists.filter((playlist) => playlist.id !== selectedPlaylist.id);
      const nextId = remaining[0]?.id || "";
      setPlaylists(remaining);
      setSelectedId(nextId);
      setTracks([]);
      setTracksMeta({ lastFetchedAt: null, fromCache: false, isStale: true });
      setPlaylistsMeta({ lastSyncedAt: new Date().toISOString(), fromCache: false, isStale: false });
      setTracksByPlaylist((current) => {
        const next = { ...current };
        delete next[selectedPlaylist.id];
        return next;
      });
      setWorkspaceView("tracks");
      setNotice(`Playlist deleted: ${selectedPlaylist.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete playlist");
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
    setBusyLabel("Searching…");
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
    setBusyLabel("Adding track…");
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
    if (!window.confirm(`Remove “${track.title}” from this playlist?`)) return;
    setBusy(`remove:${track.sourceTrackId}`);
    setBusyLabel("Removing track…");
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
     
    void readJson<SessionStatus>("/api/youtube-browser/status")
      .then(setSession)
      .catch(() => setSession(null));
    if (initialPlaylists.playlists.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      {session && !session.isBrowserAutomationEnabled ? (
        <Callout
          tone="warning"
          title="Browser automation is off"
          action={
            <Link href="/connections" className="btn btn-ghost">
              Connections
            </Link>
          }
        >
          This page reads YouTube Music through a real browser session. Set{" "}
          <code className="text-[var(--text)]">YOUTUBE_BROWSER_AUTOMATION=true</code> to use it; until then the app
          serves mock data.
        </Callout>
      ) : null}

      {session?.isBrowserAutomationEnabled && !session.hasState ? (
        <Callout
          tone="warning"
          title="No saved session"
          action={
            <Link href="/connections" className="btn btn-ghost">
              Upload session
            </Link>
          }
        >
          Log in once with <code className="text-[var(--text)]">npm run login -- youtube cdp</code>, or upload the
          exported browser state on the Connections page.
        </Callout>
      ) : null}

      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {notice ? (
        <Callout tone="success" role="status" icon={<CheckCircle2 size={16} className="mt-0.5 shrink-0" />}>
          {notice}
        </Callout>
      ) : null}
      {busyLabel ? (
        <Callout tone="info" role="status" icon={<Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />}>
          {busyLabel}
        </Callout>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className="min-w-0 lg:border-r lg:border-[var(--border-soft)] lg:pr-5">
          <div className="section-head items-center">
            <div className="min-w-0">
              <h2 className="heading-panel">Playlists</h2>
              {playlistsMeta.lastSyncedAt ? (
                <div className="text-xs text-muted-fg">Updated {formatRelative(playlistsMeta.lastSyncedAt, nowMs)}</div>
              ) : null}
            </div>
            <button onClick={() => loadPlaylists(true)} disabled={busy !== null} className="btn btn-ghost">
              <RefreshCw size={15} className={busy === "playlists" ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
          <form onSubmit={createPlaylist} className="mb-3 border-b border-[var(--border-soft)] pb-3">
            <label htmlFor="youtube-new-playlist" className="field-label">New private playlist</label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="youtube-new-playlist"
                name="youtubePlaylistName"
                autoComplete="off"
                maxLength={150}
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                placeholder="Playlist name…"
                className="min-w-0 flex-1 text-sm"
              />
              <button type="submit" disabled={busy !== null || !newPlaylistName.trim()} className="btn btn-primary">
                {busy === "create-playlist" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Create
              </button>
            </div>
          </form>
          <div className="-mx-2 max-h-[560px] overflow-y-auto">
            {busy === "playlists" && playlists.length === 0 ? <LoadingRow label="Loading playlists…" /> : null}
            {!busy && playlists.length === 0 ? <EmptyRow label="No playlists loaded yet" /> : null}
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                aria-pressed={selectedId === playlist.id}
                onClick={() => {
                  setSelectedId(playlist.id);
                  setWorkspaceView("tracks");
                  const snapshot = tracksByPlaylist[playlist.id];
                  setTracks(snapshot?.tracks || []);
                  setTracksMeta({
                    lastFetchedAt: snapshot?.lastFetchedAt || null,
                    fromCache: snapshot?.fromCache || false,
                    isStale: snapshot?.isStale ?? true,
                  });
                  loadTracks(playlist.id);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-[var(--radius-sm)] p-2 text-left hover:bg-surface-3 ${selectedId === playlist.id ? "bg-[var(--accent-soft)]" : ""}`}
              >
                <div
                  className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-3 bg-cover bg-center text-xs font-semibold text-muted-fg"
                  style={playlist.imageUrl ? { backgroundImage: `url(${playlist.imageUrl})` } : undefined}
                >
                  {playlist.imageUrl ? null : playlist.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{playlist.name}</div>
                  <div className="text-xs text-muted-fg">{playlist.trackCount} tracks</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <div className="section-head flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="heading-panel">{selectedPlaylist?.name || "Select playlist"}</h2>
              <div className="text-sm text-muted-fg">
                {tracks.length} tracks{selectedId && tracksMeta.lastFetchedAt ? ` · updated ${formatRelative(tracksMeta.lastFetchedAt, nowMs)}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => loadTracks(selectedId, true)} disabled={!selectedId || busy !== null} className="btn btn-ghost">
                <RefreshCw size={16} className={busy === "tracks" ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                type="button"
                onClick={deleteSelectedPlaylist}
                disabled={!selectedId || busy !== null}
                className="btn btn-danger"
              >
                {busy === "delete-playlist" ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Delete
              </button>
            </div>
          </div>

          <div className="mb-4 inline-flex rounded-[var(--radius-sm)] bg-surface-2 p-1" role="tablist" aria-label="Playlist workspace">
            <button id="youtube-tracks-tab" aria-controls="youtube-workspace-panel" type="button" role="tab" aria-selected={workspaceView === "tracks"} onClick={() => setWorkspaceView("tracks")} className={`inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium ${workspaceView === "tracks" ? "bg-surface-3 text-[var(--text)]" : "text-muted-fg"}`}>
              <ListMusic size={15} /> Playlist songs
            </button>
            <button id="youtube-search-tab" aria-controls="youtube-workspace-panel" type="button" role="tab" aria-selected={workspaceView === "search"} onClick={() => setWorkspaceView("search")} className={`inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium ${workspaceView === "search" ? "bg-surface-3 text-[var(--text)]" : "text-muted-fg"}`}>
              <Plus size={15} /> Add songs
            </button>
          </div>

          {workspaceView === "tracks" ? (
            <div id="youtube-workspace-panel" role="tabpanel" aria-labelledby="youtube-tracks-tab" className="divide-y divide-[var(--border-soft)]">
              {busy === "tracks" && tracks.length === 0 ? <LoadingRow label="Loading tracks…" /> : null}
              {!busy && !selectedId ? <EmptyRow label="Pick a playlist on the left to see its tracks." /> : null}
              {!busy && selectedId && tracks.length === 0 ? <EmptyRow label="No tracks to show yet. Press Refresh to load this playlist." /> : null}
              {tracks.map((track) => {
                const ytUrl = track.url || `https://music.youtube.com/watch?v=${track.sourceTrackId}`;
                return (
                  <div key={track.sourceTrackId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 py-3">
                    <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-3 bg-cover bg-center text-muted-fg" style={track.imageUrl ? { backgroundImage: `url(${track.imageUrl})` } : undefined}>{track.imageUrl ? null : <Music2 size={16} />}</div>
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{track.title}</div><div className="truncate text-xs text-muted-fg">{track.artists.join(", ")} {formatDuration(track.durationMs) ? `· ${formatDuration(track.durationMs)}` : ""}</div></div>
                    <div className="flex items-center gap-2">
                      <a href={ytUrl} target="_blank" rel="noreferrer" title="Open in YouTube Music" aria-label={`Open ${track.title} in YouTube Music`} className="btn btn-ghost btn-icon text-muted-fg hover:text-[var(--text)]"><ExternalLink size={16} /></a>
                      <button type="button" onClick={() => removeTrack(track)} disabled={busy !== null} title="Remove" aria-label={`Remove ${track.title}`} className="btn btn-ghost btn-icon text-muted-fg hover:border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] hover:bg-danger-soft hover:text-danger-fg">{busy === `remove:${track.sourceTrackId}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div id="youtube-workspace-panel" role="tabpanel" aria-labelledby="youtube-search-tab">
              <form onSubmit={search} className="flex flex-col gap-3 border-b border-line-soft pb-4 sm:flex-row">
                <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" size={16} /><input name="youtubeSearch" type="search" autoComplete="off" spellCheck={false} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Artist – track…" aria-label="Search YouTube Music" className="h-10 w-full pl-9 text-sm" /></div>
                <button disabled={busy !== null || !searchQuery.trim()} className="btn btn-primary h-10 px-4">{busy === "search" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search</button>
              </form>
              <div className="divide-y divide-[var(--border-soft)]">
                {!busy && !searchQuery && searchResults.length === 0 ? <EmptyRow label="Search YouTube Music, then add a result to the selected playlist." /> : null}
                {busy === "search" && searchResults.length === 0 ? <LoadingRow label="Searching…" /> : null}
                {!busy && searchQuery && searchResults.length === 0 ? <EmptyRow label="Nothing matched that search." /> : null}
                {searchResults.map((track) => {
                  const query = `${track.artists[0] || ""} ${track.title}`.trim();
                  const ytUrl = track.url || `https://music.youtube.com/watch?v=${track.sourceTrackId}`;
                  return (
                    <div key={track.sourceTrackId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 py-3">
                      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-3 bg-cover bg-center text-muted-fg" style={track.imageUrl ? { backgroundImage: `url(${track.imageUrl})` } : undefined}>{track.imageUrl ? null : <Music2 size={16} />}</div>
                      <div className="min-w-0"><div className="truncate text-sm font-medium">{track.title}</div><div className="truncate text-xs text-muted-fg">{track.artists.join(", ")}</div></div>
                      <div className="flex items-center gap-2">
                        <a href={ytUrl} target="_blank" rel="noreferrer" title="Open in YouTube Music" aria-label={`Open ${track.title} in YouTube Music`} className="btn btn-ghost btn-icon text-muted-fg hover:text-[var(--text)]"><ExternalLink size={16} /></a>
                        <button type="button" onClick={() => addTrack(query)} disabled={!selectedId || busy !== null} title="Add" aria-label={`Add ${track.title}`} className="btn btn-ghost btn-icon text-muted-fg hover:border-[color-mix(in_srgb,var(--success)_35%,var(--border))] hover:bg-success-soft hover:text-success-fg">{busy === `add:${query}` ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-fg">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="p-4 text-sm text-muted-fg">{label}</div>;
}
