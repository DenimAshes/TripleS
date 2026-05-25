"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Hash,
  Music,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

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

type SortKey = "position" | "title" | "artists" | "album" | "duration";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "linked" | "missing" | "excluded";

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatTotalDuration(ms: number) {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderHighlight(text: string, query: string) {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerText.includes(lowerQuery)) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerQuery, cursor);
  let key = 0;
  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark key={`m-${key++}`} className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-[var(--accent-hover)]">
        {text.slice(match, match + query.length)}
      </mark>,
    );
    cursor = match + query.length;
    match = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function renderSortIcon(key: SortKey, sortKey: SortKey, sortDir: SortDir) {
  if (sortKey !== key) return <ArrowUpDown size={11} className="opacity-40" />;
  return sortDir === "asc" ? (
    <ArrowUp size={11} className="text-[var(--accent)]" />
  ) : (
    <ArrowDown size={11} className="text-[var(--accent)]" />
  );
}

export function PlaylistTracksTable({ tracks, service }: { tracks: PlaylistTrackRow[]; service: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [visibleState, setVisibleState] = useState({ key: "", count: INITIAL_VISIBLE_TRACKS });
  const [, startTransition] = useTransition();
  const [excludedByTrack, setExcludedByTrack] = useState<Record<string, boolean>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [matchEditor, setMatchEditor] = useState<{ trackId: string; targetService: string; url: string } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function isExcluded(track: PlaylistTrackRow) {
    return excludedByTrack[track.id] ?? Boolean(track.isExcluded);
  }

  const totalDurationMs = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0),
    [tracks],
  );
  const stats = useMemo(() => {
    let fullyLinked = 0;
    let missing = 0;
    let excluded = 0;
    const missingByService: Record<string, number> = {};
    for (const track of tracks) {
      if (excludedByTrack[track.id] ?? track.isExcluded) excluded++;
      const missingList = track.missingServices || [];
      if (missingList.length === 0 && (track.linkedServices?.length ?? 0) > 0) fullyLinked++;
      if (missingList.length > 0) missing++;
      for (const svc of missingList) missingByService[svc] = (missingByService[svc] || 0) + 1;
    }
    return { fullyLinked, missing, excluded, missingByService };
  }, [tracks, excludedByTrack]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let next = tracks;
    if (statusFilter !== "all") {
      next = next.filter((track) => {
        const ex = excludedByTrack[track.id] ?? Boolean(track.isExcluded);
        if (statusFilter === "linked") return (track.missingServices?.length ?? 0) === 0 && (track.linkedServices?.length ?? 0) > 0 && !ex;
        if (statusFilter === "missing") return (track.missingServices?.length ?? 0) > 0;
        if (statusFilter === "excluded") return ex;
        return true;
      });
    }
    if (needle) {
      next = next.filter((track) => `${track.title} ${track.artists} ${track.album || ""}`.toLowerCase().includes(needle));
    }
    if (sortKey !== "position" || sortDir !== "asc") {
      const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
      const dir = sortDir === "asc" ? 1 : -1;
      const sorted = [...next];
      sorted.sort((a, b) => {
        if (sortKey === "position") return (a.position - b.position) * dir;
        if (sortKey === "duration") return ((a.durationMs || 0) - (b.durationMs || 0)) * dir;
        if (sortKey === "title") return collator.compare(a.title, b.title) * dir;
        if (sortKey === "artists") return collator.compare(a.artists, b.artists) * dir;
        if (sortKey === "album") return collator.compare(a.album || "", b.album || "") * dir;
        return 0;
      });
      return sorted;
    }
    return next;
  }, [query, tracks, statusFilter, excludedByTrack, sortKey, sortDir]);

  const visibleKey = `${query}\0${statusFilter}\0${sortKey}\0${sortDir}\0${tracks.length}`;
  const visibleCount = visibleState.key === visibleKey ? visibleState.count : INITIAL_VISIBLE_TRACKS;
  const visibleTracks = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remainingCount = Math.max(0, filtered.length - visibleTracks.length);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir(key === "duration" ? "desc" : "asc");
      return key;
    });
  }, []);

  function setBusy(trackId: string, busy: boolean) {
    setRowBusy((current) => {
      const next = { ...current };
      if (busy) next[trackId] = true;
      else delete next[trackId];
      return next;
    });
  }

  function setError(trackId: string, message: string | null) {
    setRowError((current) => {
      const next = { ...current };
      if (message) next[trackId] = message;
      else delete next[trackId];
      return next;
    });
  }

  async function toggleExcluded(track: PlaylistTrackRow) {
    if (!track.groupId || !track.playlistId || !track.serviceTrackId) return;
    const nextExcluded = !isExcluded(track);
    setBusy(track.id, true);
    setError(track.id, null);
    setExcludedByTrack((current) => ({ ...current, [track.id]: nextExcluded }));
    try {
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
        const body = await response.json().catch(() => ({}));
        setExcludedByTrack((current) => ({ ...current, [track.id]: !nextExcluded }));
        setError(track.id, body?.error || `Update failed (${response.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setExcludedByTrack((current) => ({ ...current, [track.id]: !nextExcluded }));
      setError(track.id, error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(track.id, false);
    }
  }

  function matchServicesFor(track: PlaylistTrackRow) {
    return Array.from(new Set([...(track.missingServices || []), ...(track.linkedServices || [])]));
  }

  function openMatchEditor(track: PlaylistTrackRow) {
    const services = matchServicesFor(track);
    setError(track.id, null);
    setMatchEditor({
      trackId: track.id,
      targetService: services[0] || "",
      url: "",
    });
  }

  async function changeMatch(track: PlaylistTrackRow) {
    if (!track.groupId || !track.serviceTrackId || !matchEditor || matchEditor.trackId !== track.id) return;
    const services = matchServicesFor(track);
    const targetService = matchEditor.targetService;
    if (!targetService) return;
    if (!services.includes(targetService)) {
      setError(track.id, "Choose one of the available services for this row.");
      return;
    }
    const trimmedUrl = matchEditor.url.trim();
    if (!trimmedUrl) {
      setError(track.id, "Paste a song link.");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError(track.id, "Link must start with http:// or https://");
      return;
    }

    setBusy(track.id, true);
    setError(track.id, null);
    try {
      const response = await fetch(`/api/playlist-groups/${track.groupId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTrackId: track.serviceTrackId,
          targetService,
          url: trimmedUrl,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(track.id, body?.error || `Override failed (${response.status})`);
        return;
      }
      setMatchEditor(null);
      startTransition(() => router.refresh());
    } catch (error) {
      setError(track.id, error instanceof Error ? error.message : "Override failed");
    } finally {
      setBusy(track.id, false);
    }
  }

  const statusFilters: Array<{ key: StatusFilter; label: string; count: number; icon: React.ReactNode; tone: string }> = [
    { key: "all", label: "All", count: tracks.length, icon: <Hash size={12} />, tone: "" },
    { key: "linked", label: "Linked", count: stats.fullyLinked, icon: <CheckCircle2 size={12} />, tone: "pill-success" },
    { key: "missing", label: "Missing", count: stats.missing, icon: <AlertTriangle size={12} />, tone: "pill-warning" },
    { key: "excluded", label: "Excluded", count: stats.excluded, icon: <X size={12} />, tone: "" },
  ];
  const trimmedQuery = query.trim();

  function jumpToNextMissing() {
    // If we're filtered to Linked / Excluded right now, the missing rows simply
    // aren't on screen. Flip filter first and let the next click jump within
    // the freshly-rendered list — predictable two-step behavior.
    if (statusFilter === "linked" || statusFilter === "excluded") {
      setStatusFilter("missing");
      return;
    }
    const missingInOrder = filtered.filter((track) => (track.missingServices?.length ?? 0) > 0);
    if (!missingInOrder.length) return;

    // Make sure the next missing row is actually rendered: if it sits beyond
    // the "Load more" cutoff, expand the window to include it before scrolling.
    const firstHiddenIndex = missingInOrder.findIndex((track) => filtered.indexOf(track) >= visibleCount);
    if (firstHiddenIndex !== -1) {
      const neededIndex = filtered.indexOf(missingInOrder[firstHiddenIndex]) + 1;
      setVisibleState({ key: visibleKey, count: Math.max(visibleCount, neededIndex) });
    }

    // Defer the scroll until after the (possibly expanded) list paints.
    requestAnimationFrame(() => {
      const candidates = missingInOrder
        .map((track) => document.querySelector<HTMLElement>(`[data-track-row='${track.id}']`))
        .filter((node): node is HTMLElement => Boolean(node));
      const viewportTop = window.scrollY + 120;
      const next = candidates.find((node) => node.offsetTop > viewportTop) ?? candidates[0];
      if (!next) return;
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      next.setAttribute("data-pulse", "1");
      window.setTimeout(() => next.removeAttribute("data-pulse"), 1400);
    });
  }

  return (
    <div className="space-y-4">
      <section className="panel surface-lift animated-sheen relative overflow-hidden p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-70" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,auto)] lg:items-center">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="pill">
              <Hash size={12} />
              <span className="tabular-nums">{tracks.length}</span> songs
            </span>
            <span className="pill">
              <Clock3 size={12} />
              {formatTotalDuration(totalDurationMs)}
            </span>
            {stats.fullyLinked > 0 ? (
              <span className="pill pill-success">
                <CheckCircle2 size={12} />
                <span className="tabular-nums">{stats.fullyLinked}</span> linked
              </span>
            ) : null}
            {stats.missing > 0 ? (
              <button
                type="button"
                onClick={jumpToNextMissing}
                title={`Jump to next missing track${Object.entries(stats.missingByService).length ? ` — ${Object.entries(stats.missingByService).map(([svc, n]) => `${SERVICE_LABELS[svc] || svc}: ${n}`).join(", ")}` : ""}`}
                className="pill pill-warning surface-lift hover:brightness-110"
              >
                <AlertTriangle size={12} />
                <span className="tabular-nums">{stats.missing}</span> missing
                <ArrowDown size={11} className="opacity-70" />
              </button>
            ) : null}
            {stats.excluded > 0 ? (
              <span className="pill" title="Only kept in this playlist">
                <X size={12} />
                <span className="tabular-nums">{stats.excluded}</span> excluded
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="surface-lift group/search relative min-w-0 flex-1 sm:max-w-xs lg:flex-none">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim-fg transition group-focus-within/search:text-[var(--accent)]"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter songs…"
                aria-label="Filter songs"
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] py-1.5 pl-9 pr-12 text-sm text-[var(--text)] placeholder:text-dim-fg focus:border-[var(--accent)]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-dim-fg transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none rounded-md border border-[var(--border-soft)] bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim-fg"
                  aria-hidden="true"
                >
                  /
                </kbd>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Status filter">
          {statusFilters.map((filter) => {
            const active = statusFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={active}
                disabled={filter.count === 0 && filter.key !== "all"}
                className={`surface-lift inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--text)] shadow-[0_14px_30px_-28px_var(--accent-glow)]"
                    : "border-[var(--border-soft)] bg-[var(--surface-2)] text-muted-fg hover:border-[var(--border)] hover:text-[var(--text)]"
                }`}
              >
                {filter.icon}
                {filter.label}
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-[var(--accent)]/20" : "bg-black/25"}`}>{filter.count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="panel text-muted-fg p-8 text-center text-sm">
          {trimmedQuery || statusFilter !== "all" ? (
            <>
              <p>No songs match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)]"
              >
                <X size={12} /> Clear filters
              </button>
            </>
          ) : (
            "No songs found."
          )}
        </div>
      ) : (
        // overflow-hidden would create a non-scrolling ancestor and break the
        // sticky thead — sort headers must follow the viewport, not the panel.
        <div className="panel">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 text-dim-fg border-b border-[var(--border-soft)] bg-[var(--surface-2)]/95 text-left text-xs font-semibold tracking-widest uppercase backdrop-blur">
              <tr>
                <th
                  className="w-12 px-4 py-3.5"
                  aria-sort={sortKey === "position" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("position")}
                    className="inline-flex items-center gap-1.5 font-semibold transition hover:text-[var(--text)]"
                  >
                    # {renderSortIcon("position", sortKey, sortDir)}
                  </button>
                </th>
                <th
                  className="px-4 py-3.5"
                  aria-sort={sortKey === "title" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("title")}
                    className="inline-flex items-center gap-1.5 font-semibold transition hover:text-[var(--text)]"
                  >
                    Song {renderSortIcon("title", sortKey, sortDir)}
                  </button>
                </th>
                <th className="hidden px-4 py-3.5 font-semibold lg:table-cell">Matched on</th>
                <th
                  className="hidden px-4 py-3.5 md:table-cell"
                  aria-sort={sortKey === "album" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("album")}
                    className="inline-flex items-center gap-1.5 font-semibold transition hover:text-[var(--text)]"
                  >
                    Album {renderSortIcon("album", sortKey, sortDir)}
                  </button>
                </th>
                <th
                  className="w-16 px-4 py-3.5"
                  aria-sort={sortKey === "duration" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("duration")}
                    className="inline-flex items-center gap-1.5 font-semibold transition hover:text-[var(--text)]"
                  >
                    Time {renderSortIcon("duration", sortKey, sortDir)}
                  </button>
                </th>
                <th className="w-10 px-4 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)]">
              {visibleTracks.map((track, index) => {
                const trackMissing = (track.missingServices?.length ?? 0) > 0;
                const excluded = isExcluded(track);
                const matchServices = matchServicesFor(track);
                const editingMatch = matchEditor?.trackId === track.id;
                const editor = editingMatch ? matchEditor : null;
                return (
                  <Fragment key={track.id}>
                  <tr
                    data-track-row={track.id}
                    className={`group/row track-row relative transition duration-200 hover:bg-[var(--surface-2)]/40 ${
                      excluded ? "opacity-70" : ""
                    }`}
                  >
                    <td className="relative text-dim-fg px-4 py-3.5 font-medium tabular-nums">
                      {trackMissing ? (
                        <span className="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-amber-400/70" aria-hidden="true" />
                      ) : null}
                      {excluded ? (
                        <span className="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-[#fcd34d]/80" aria-hidden="true" />
                      ) : null}
                      {track.position}
                    </td>
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
                            className="h-10 w-10 shrink-0 rounded-lg border border-[var(--border-soft)] object-cover transition duration-200 group-hover/row:scale-[1.05]"
                          />
                        ) : (
                          <div
                            className="playlist-art-fallback grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--border-soft)] text-white/70"
                            aria-hidden="true"
                          >
                            <Music size={14} strokeWidth={1.5} className="relative z-10" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[var(--text)]">{renderHighlight(track.title, trimmedQuery)}</div>
                          <div className="text-muted-fg truncate text-xs">{renderHighlight(track.artists, trimmedQuery)}</div>
                          {(track.linkedServices?.length || track.missingServices?.length) ? (
                            <div className="mt-1 flex items-center gap-1 lg:hidden" aria-label="Match status">
                              {(track.linkedServices || []).map((linkedService) => (
                                <span
                                  key={`m-${linkedService}`}
                                  title={`Matched on ${SERVICE_LABELS[linkedService] || linkedService}`}
                                  className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400"
                                />
                              ))}
                              {(track.missingServices || []).map((missingService) => (
                                <span
                                  key={`x-${missingService}`}
                                  title={`Missing on ${SERVICE_LABELS[missingService] || missingService}`}
                                  className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400"
                                />
                              ))}
                              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-dim-fg">
                                {track.missingServices?.length
                                  ? `missing on ${track.missingServices.length}`
                                  : `matched`}
                              </span>
                            </div>
                          ) : null}
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
                          <span
                            key={missingService}
                            className="pill pill-warning normal-case"
                            title={`Missing on ${SERVICE_LABELS[missingService] || missingService}`}
                          >
                            <X size={11} strokeWidth={3} />
                            {SERVICE_LABELS[missingService] || missingService}
                          </span>
                        ))}
                        {track.groupId ? (
                          <span className="ml-1 inline-flex gap-1 opacity-0 transition group-hover/row:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => openMatchEditor(track)}
                              disabled={Boolean(rowBusy[track.id])}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-r hover:from-[var(--accent-soft)] hover:to-transparent disabled:opacity-60"
                            >
                              {rowBusy[track.id] ? "…" : "Change"}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleExcluded(track)}
                              disabled={Boolean(rowBusy[track.id])}
                              className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition duration-200 hover:border-[var(--border-accent)] hover:bg-gradient-to-r hover:from-[var(--accent-soft)] hover:to-transparent disabled:opacity-60"
                            >
                              {rowBusy[track.id] ? "…" : isExcluded(track) ? "Sync" : "Keep"}
                            </button>
                          </span>
                        ) : null}
                        {rowError[track.id] ? (
                          <button
                            type="button"
                            onClick={() => setError(track.id, null)}
                            title="Dismiss"
                            className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                          >
                            <AlertTriangle size={10} />
                            {rowError[track.id]}
                            <X size={10} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-muted-fg hidden truncate px-4 py-3.5 md:table-cell">
                      {track.album ? renderHighlight(track.album, trimmedQuery) : "-"}
                    </td>
                    <td className="text-muted-fg px-4 py-3.5 tabular-nums">{formatDuration(track.durationMs)}</td>
                    <td className="px-4 py-3.5">
                      {track.url ? (
                        <a
                          href={track.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-dim-fg opacity-60 transition duration-200 hover:text-[var(--accent)] group-hover/row:opacity-100"
                          aria-label={`Open on ${service}`}
                        >
                          <ExternalLink size={16} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                  {editor ? (
                    <tr className="bg-[var(--surface-2)]/35">
                      <td colSpan={6} className="px-4 py-3">
                        <form
                          className="grid gap-2 rounded-lg border border-[var(--border-soft)] bg-black/20 p-3 sm:grid-cols-[minmax(140px,180px)_minmax(0,1fr)_auto]"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void changeMatch(track);
                          }}
                        >
                          <select
                            value={editor.targetService}
                            onChange={(event) =>
                              setMatchEditor((current) =>
                                current && current.trackId === track.id ? { ...current, targetService: event.target.value } : current,
                              )
                            }
                            aria-label="Target service"
                            className="h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-2 text-sm"
                          >
                            {matchServices.map((matchService) => (
                              <option key={matchService} value={matchService}>
                                {SERVICE_LABELS[matchService] || matchService}
                              </option>
                            ))}
                          </select>
                          <input
                            value={editor.url}
                            onChange={(event) =>
                              setMatchEditor((current) =>
                                current && current.trackId === track.id ? { ...current, url: event.target.value } : current,
                              )
                            }
                            placeholder="Paste song link"
                            aria-label="Song link"
                            className="h-9 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={Boolean(rowBusy[track.id]) || !editor.targetService}
                              className="btn btn-primary h-9 text-xs"
                            >
                              <CheckCircle2 size={14} />
                              Save
                            </button>
                            <button type="button" onClick={() => setMatchEditor(null)} className="btn btn-ghost h-9 text-xs">
                              <X size={14} />
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
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
                className="surface-lift rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-accent)]"
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
