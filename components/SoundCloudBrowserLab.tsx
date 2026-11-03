"use client";

import { CheckCircle2, ExternalLink, ListMusic, Loader2, Music2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Callout } from "./Callout";
import { ArtworkImage } from "./ArtworkImage";

type SessionStatus = {
  hasState: boolean;
  isBrowserAutomationEnabled: boolean;
};

type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  url?: string;
  isWritable?: boolean;
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

type TracksResponse = { tracks: Track[]; lastFetchedAt: string | null; fromCache: boolean; isStale: boolean };
const TRACK_PAGE_SIZE = 50;
const NUMBER = new Intl.NumberFormat("en-GB");

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

export function SoundCloudBrowserLab({ initialPlaylists, nowMs }: { initialPlaylists: PlaylistsSnapshot; nowMs: number }) {
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists.playlists);
  const [selectedId, setSelectedId] = useState(initialPlaylists.playlists[0]?.id || "");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksMeta, setTracksMeta] = useState({ lastFetchedAt: null as string | null, fromCache: false, isStale: true });
  const [tracksByPlaylist, setTracksByPlaylist] = useState<Record<string, TracksResponse>>({});
  const [playlistsMeta, setPlaylistsMeta] = useState({
    lastSyncedAt: initialPlaylists.lastSyncedAt,
    fromCache: initialPlaylists.fromCache,
    isStale: initialPlaylists.isStale,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [workspaceView, setWorkspaceView] = useState<"tracks" | "search">("tracks");
  const [visibleTrackCount, setVisibleTrackCount] = useState(TRACK_PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const selectedIdRef = useRef(selectedId);
  const trackLoadRequestRef = useRef(0);
  const latestTrackRequestByPlaylistRef = useRef(new Map<string, number>());
  const searchRequestRef = useRef(0);
  const initializedRef = useRef(false);

  const selectedPlaylist = useMemo(() => playlists.find((playlist) => playlist.id === selectedId), [playlists, selectedId]);
  const trackSummary = selectedPlaylist && tracks.length < selectedPlaylist.trackCount
    ? `${NUMBER.format(tracks.length)} of ${NUMBER.format(selectedPlaylist.trackCount)} ${selectedPlaylist.trackCount === 1 ? "track" : "tracks"} loaded`
    : `${NUMBER.format(tracks.length)} ${tracks.length === 1 ? "track" : "tracks"}`;

  async function loadPlaylists(force = false): Promise<string> {
    setBusy("playlists");
    setBusyLabel(force ? "Updating playlists…" : "Loading playlists…");
    setError("");
    setNotice("");
    try {
      const data = await readJson<PlaylistsSnapshot>(`/api/soundcloud-browser/playlists${force ? "?refresh=1" : ""}`);
      setPlaylists(data.playlists);
      setPlaylistsMeta({ lastSyncedAt: data.lastSyncedAt, fromCache: data.fromCache, isStale: data.isStale });
      const currentId = selectedIdRef.current;
      const nextId = data.playlists.some((playlist) => playlist.id === currentId) ? currentId : data.playlists[0]?.id || "";
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      if (nextId !== currentId) {
        const snapshot = tracksByPlaylist[nextId];
        setTracks(snapshot?.tracks || []);
        setTracksMeta({
          lastFetchedAt: snapshot?.lastFetchedAt || null,
          fromCache: snapshot?.fromCache || false,
          isStale: snapshot?.isStale ?? true,
        });
        setVisibleTrackCount(TRACK_PAGE_SIZE);
      }
      return nextId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SoundCloud playlists");
      return "";
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function refreshPlaylists() {
    const previousId = selectedIdRef.current;
    const nextId = await loadPlaylists(true);
    if (nextId && nextId !== previousId) await loadTracks(nextId);
  }

  async function loadTracks(playlistId = selectedId, force = false) {
    if (!playlistId) return;
    const requestId = ++trackLoadRequestRef.current;
    latestTrackRequestByPlaylistRef.current.set(playlistId, requestId);
    setError("");
    const cached = tracksByPlaylist[playlistId];
    if (!force && cached) {
      if (selectedIdRef.current === playlistId) {
        setTracks(cached.tracks);
        setTracksMeta({ lastFetchedAt: cached.lastFetchedAt, fromCache: cached.fromCache, isStale: cached.isStale });
      }
      setBusy(null);
      setBusyLabel("");
      return;
    }

    setBusy("tracks");
    setBusyLabel(force ? "Updating tracks…" : "Loading tracks…");
    try {
      const data = await readJson<TracksResponse>(`/api/soundcloud-browser/tracks?playlistId=${encodeURIComponent(playlistId)}${force ? "&refresh=1" : ""}`);
      if (latestTrackRequestByPlaylistRef.current.get(playlistId) === requestId) {
        setTracksByPlaylist((current) => ({ ...current, [playlistId]: data }));
        if (force && !data.isStale) {
          setPlaylists((current) => current.map((playlist) => playlist.id === playlistId ? { ...playlist, trackCount: data.tracks.length } : playlist));
        }
        if (selectedIdRef.current === playlistId) {
          setTracks(data.tracks);
          setTracksMeta({ lastFetchedAt: data.lastFetchedAt, fromCache: data.fromCache, isStale: data.isStale });
        }
      }
    } catch (err) {
      if (requestId === trackLoadRequestRef.current && selectedIdRef.current === playlistId) {
        setError(err instanceof Error ? err.message : "Could not load SoundCloud tracks");
      }
    } finally {
      if (requestId === trackLoadRequestRef.current) {
        setBusy(null);
        setBusyLabel("");
      }
    }
  }

  function selectPlaylist(playlistId: string) {
    selectedIdRef.current = playlistId;
    setSelectedId(playlistId);
    setWorkspaceView("tracks");
    setVisibleTrackCount(TRACK_PAGE_SIZE);
    setNotice("");
    const snapshot = tracksByPlaylist[playlistId];
    setTracks(snapshot?.tracks || []);
    setTracksMeta({
      lastFetchedAt: snapshot?.lastFetchedAt || null,
      fromCache: snapshot?.fromCache || false,
      isStale: snapshot?.isStale ?? true,
    });
    void loadTracks(playlistId);
  }

  function handleWorkspaceTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === "ArrowRight" || event.key === "End"
      ? "search"
      : event.key === "ArrowLeft" || event.key === "Home"
        ? "tracks"
        : null;
    if (!next) return;
    event.preventDefault();
    setWorkspaceView(next);
    document.getElementById(`soundcloud-${next}-tab`)?.focus();
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (busy !== null || !query) return;
    const requestId = ++searchRequestRef.current;
    setSubmittedQuery(query);
    setSearchResults([]);
    setBusy("search");
    setBusyLabel("Searching…");
    setError("");
    setNotice("");
    try {
      const data = await readJson<{ tracks: Track[] }>(`/api/soundcloud-browser/search?q=${encodeURIComponent(query)}`);
      if (requestId === searchRequestRef.current) setSearchResults(data.tracks.slice(0, 12));
    } catch (err) {
      if (requestId === searchRequestRef.current) {
        setError(err instanceof Error ? err.message : "Could not search SoundCloud");
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setBusy(null);
        setBusyLabel("");
      }
    }
  }

  async function addTrack(track: Track) {
    if (!selectedId) return;
    const trackId = track.url || track.sourceTrackId;
    setBusy(`add:${track.sourceTrackId}`);
    setBusyLabel("Adding track…");
    setError("");
    setNotice("");
    try {
      const result = await readJson<{ ok: boolean; added: boolean }>("/api/soundcloud-browser/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: selectedId, trackId }),
      });
      setNotice(result.added ? "Track added" : "Already in playlist");
      await loadTracks(selectedId, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add SoundCloud track");
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
      const result = await readJson<{ ok: boolean; removed: boolean }>("/api/soundcloud-browser/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: selectedId, trackId: track.url || track.sourceTrackId }),
      });
      setNotice(result.removed ? "Track removed" : "Track was already absent");
      await loadTracks(selectedId, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove SoundCloud track");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void readJson<SessionStatus>("/api/soundcloud-browser/status")
      .then(setSession)
      .catch(() => setSession(null));
    if (initialPlaylists.playlists.length > 0) {
      void loadTracks(initialPlaylists.playlists[0].id);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlaylists(true).then((playlistId) => {
      if (playlistId) void loadTracks(playlistId);
    });
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
          This page drives SoundCloud through a real browser session. Set{" "}
          <code className="text-[var(--text)]">SOUNDCLOUD_BROWSER_AUTOMATION=true</code> to use it; until then the app
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
          Log in once with <code className="text-[var(--text)]">npm run login -- soundcloud cdp</code>, or upload the
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
            <button type="button" onClick={refreshPlaylists} disabled={busy !== null} className="btn btn-ghost">
              <RefreshCw size={15} className={busy === "playlists" ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
          <div className="-mx-2 max-h-72 overflow-y-auto lg:max-h-[calc(100vh-18rem)] lg:overscroll-contain">
            {busy === "playlists" && playlists.length === 0 ? <LoadingRow label="Loading playlists…" /> : null}
            {!busy && playlists.length === 0 ? <EmptyRow label="No playlists loaded yet" /> : null}
            {playlists.map((playlist) => (
              <button
                type="button"
                key={playlist.id}
                aria-pressed={selectedId === playlist.id}
                disabled={busy !== null && busy !== "tracks"}
                onClick={() => selectPlaylist(playlist.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-[var(--radius-sm)] p-2 text-left hover:bg-surface-3 disabled:cursor-wait disabled:opacity-60 ${selectedId === playlist.id ? "bg-[var(--accent-soft)]" : ""}`}
              >
                <ArtworkImage src={playlist.imageUrl} width={40} height={40} className="size-10 rounded-[var(--radius-sm)] bg-surface-3 text-xs font-semibold text-muted-fg" fallback={playlist.name.slice(0, 2).toUpperCase()} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={playlist.name}>{playlist.name}</div>
                  <div className="text-xs text-muted-fg">
                    {NUMBER.format(playlist.trackCount)} {playlist.trackCount === 1 ? "track" : "tracks"} {playlist.isWritable ? "" : "· read-only"}
                  </div>
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
                {trackSummary}{selectedId && tracksMeta.lastFetchedAt ? ` · updated ${formatRelative(tracksMeta.lastFetchedAt, nowMs)}` : ""}
              </div>
            </div>
            <button type="button" onClick={() => loadTracks(selectedId, true)} disabled={!selectedId || busy !== null} className="btn btn-ghost">
              <RefreshCw size={16} className={busy === "tracks" ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          <div className="mb-4 inline-flex rounded-[var(--radius-sm)] bg-surface-2 p-1" role="tablist" aria-label="Playlist workspace">
            <button id="soundcloud-tracks-tab" aria-controls="soundcloud-workspace-panel" type="button" role="tab" tabIndex={workspaceView === "tracks" ? 0 : -1} aria-selected={workspaceView === "tracks"} onKeyDown={handleWorkspaceTabKeyDown} onClick={() => setWorkspaceView("tracks")} className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium ${workspaceView === "tracks" ? "bg-surface-3 text-[var(--text)]" : "text-muted-fg"}`}>
              <ListMusic size={15} /> Playlist songs
            </button>
            <button id="soundcloud-search-tab" aria-controls="soundcloud-workspace-panel" type="button" role="tab" tabIndex={workspaceView === "search" ? 0 : -1} aria-selected={workspaceView === "search"} onKeyDown={handleWorkspaceTabKeyDown} onClick={() => setWorkspaceView("search")} className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium ${workspaceView === "search" ? "bg-surface-3 text-[var(--text)]" : "text-muted-fg"}`}>
              <Plus size={15} /> Add songs
            </button>
          </div>

          {workspaceView === "tracks" ? (
            <div
              id="soundcloud-workspace-panel"
              role="tabpanel"
              aria-labelledby="soundcloud-tracks-tab"
              className="divide-y divide-[var(--border-soft)] lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
            >
              {busy === "tracks" && tracks.length === 0 ? <LoadingRow label="Loading tracks…" /> : null}
              {!busy && !selectedId ? <EmptyRow label="Pick a playlist on the left to see its tracks." /> : null}
              {!busy && selectedId && tracks.length === 0 ? <EmptyRow label="No tracks to show yet. Press Refresh to load this playlist." /> : null}
              {tracks.slice(0, visibleTrackCount).map((track) => (
                <TrackRow key={track.sourceTrackId} track={track} busy={busy} canWrite={selectedPlaylist?.isWritable === true} onRemove={removeTrack} />
              ))}
              {tracks.length > visibleTrackCount ? (
                <button
                  type="button"
                  onClick={() => setVisibleTrackCount((count) => count + TRACK_PAGE_SIZE)}
                  className="btn btn-ghost my-3 w-full"
                >
                  Load {Math.min(TRACK_PAGE_SIZE, tracks.length - visibleTrackCount)} more · {tracks.length - visibleTrackCount} hidden
                </button>
              ) : null}
            </div>
          ) : (
            <div id="soundcloud-workspace-panel" role="tabpanel" aria-labelledby="soundcloud-search-tab">
              <form onSubmit={search} className="flex flex-col gap-3 border-b border-line-soft pb-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" size={16} />
                  <input name="soundcloudSearch" type="search" autoComplete="off" spellCheck={false} maxLength={200} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Artist – track…" aria-label="Search SoundCloud" className="h-11 w-full pl-9 text-sm" />
                </div>
                <button type="submit" disabled={busy !== null || !searchQuery.trim()} className="btn btn-primary h-11 px-4">
                  {busy === "search" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search
                </button>
              </form>
              <div className="divide-y divide-[var(--border-soft)]">
                {!busy && !submittedQuery ? <EmptyRow label="Search SoundCloud, then add a result to the selected playlist." /> : null}
                {busy === "search" && searchResults.length === 0 ? <LoadingRow label="Searching…" /> : null}
                {!busy && submittedQuery && searchQuery.trim() !== submittedQuery ? <EmptyRow label="Press Search to update these results." /> : null}
                {!busy && searchQuery.trim() === submittedQuery && searchResults.length === 0 ? <EmptyRow label="Nothing matched that search." /> : null}
                {(searchQuery.trim() === submittedQuery ? searchResults : []).map((track) => (
                  <TrackRow key={track.sourceTrackId} track={track} busy={busy} canWrite={selectedPlaylist?.isWritable === true} onAdd={addTrack} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TrackRow({
  track,
  busy,
  canWrite,
  onAdd,
  onRemove,
}: {
  track: Track;
  busy: string | null;
  canWrite: boolean;
  onAdd?: (track: Track) => void;
  onRemove?: (track: Track) => void;
}) {
  const href = track.url || `https://soundcloud.com/${track.sourceTrackId}`;
  const busyKey = onAdd ? `add:${track.sourceTrackId}` : `remove:${track.sourceTrackId}`;

  return (
    <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3 py-3">
      <ArtworkImage src={track.imageUrl} width={40} height={40} className="size-10 rounded-[var(--radius-sm)] bg-surface-3 text-muted-fg" fallback={<Music2 size={16} />} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium" title={track.title}>{track.title}</div>
        <div className="truncate text-xs text-muted-fg" title={track.artists.join(", ")}>
          {track.artists.join(", ")} {formatDuration(track.durationMs) ? `· ${formatDuration(track.durationMs)}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
         <a
          href={href}
          target="_blank"
          rel="noreferrer"
           title="Open in SoundCloud"
           aria-label={`Open ${track.title} in SoundCloud`}
          className="btn btn-ghost btn-icon text-muted-fg hover:text-[var(--text)]"
        >
          <ExternalLink size={16} />
        </a>
        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(track)}
            disabled={!canWrite || busy !== null}
           title="Add"
            aria-label={`Add ${track.title}`}
            className="btn btn-ghost btn-icon text-muted-fg hover:border-[color-mix(in_srgb,var(--success)_35%,var(--border))] hover:bg-success-soft hover:text-success-fg"
          >
            {busy === busyKey ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(track)}
            disabled={!canWrite || busy !== null}
           title="Remove"
            aria-label={`Remove ${track.title}`}
            className="btn btn-ghost btn-icon text-muted-fg hover:border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] hover:bg-danger-soft hover:text-danger-fg"
          >
            {busy === busyKey ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        ) : null}
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
