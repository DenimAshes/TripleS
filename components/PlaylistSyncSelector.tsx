"use client";

import type { SyncDestination, SyncRule } from "@prisma/client";
import {
  Check,
  Eye,
  EyeOff,
  Layers3,
  Link2,
  ListMusic,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ServiceStatusRowProps } from "./ServiceStatusRow";
import { ServiceIcon, serviceMeta } from "./ServiceBrand";

export type ServiceStatus = ServiceStatusRowProps;

export type PlaylistOption = {
  id: string;
  service: string;
  servicePlaylistId: string;
  name: string;
  description: string | null;
  trackCount: number;
  isWritable: boolean;
  imageUrl?: string | null;
  coverImages?: string[];
  hidden?: boolean;
  groupId?: string | null;
  groupName?: string | null;
};

type RuleWithDestinations = Pick<
  SyncRule,
  "id" | "name" | "sourceService" | "sourcePlaylistId" | "mode" | "intervalMinutes" | "isEnabled"
> & {
  destinations: Pick<SyncDestination, "service" | "playlistId" | "isEnabled">[];
};

const SERVICES = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"];
const SERVICE_NAMES: Record<string, string> = {
  SPOTIFY: "Spotify",
  YOUTUBE: "YouTube Music",
  SOUNDCLOUD: "SoundCloud",
};

function Artwork({ playlist, compact = false }: { playlist: PlaylistOption; compact?: boolean }) {
  const size = compact ? "h-12 w-12" : "h-14 w-14 sm:h-16 sm:w-16";
  const images = playlist.imageUrl ? [playlist.imageUrl] : Array.from(new Set(playlist.coverImages || [])).slice(0, 4);

  if (images.length === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={images[0]} alt="" className={`${size} shrink-0 rounded-lg object-cover ring-1 ring-[var(--border-soft)]`} />
    );
  }

  if (images.length > 1) {
    return (
      <div className={`${size} grid shrink-0 grid-cols-2 overflow-hidden rounded-lg ring-1 ring-[var(--border-soft)]`}>
        {images.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${src}-${index}`} src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        ))}
      </div>
    );
  }

  return (
    <div className={`${size} playlist-art-fallback grid shrink-0 place-items-center rounded-lg text-white/75 ring-1 ring-[var(--border-soft)]`}>
      <ListMusic size={compact ? 17 : 20} strokeWidth={1.6} className="relative z-10" />
    </div>
  );
}

export function PlaylistSyncSelector({
  playlists,
  rule,
}: {
  playlists: PlaylistOption[];
  rule?: RuleWithDestinations;
  serviceStatuses?: Record<string, ServiceStatus>;
}) {
  const router = useRouter();
  const [activeService, setActiveService] = useState(rule?.sourceService || "SPOTIFY");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const savedPinned = JSON.parse(window.localStorage.getItem("playlists:pinned") || "[]");
      return new Set(Array.isArray(savedPinned) ? savedPinned.filter((value) => typeof value === "string") : []);
    } catch {
      return new Set();
    }
  });
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingHide, startHideTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!saveOutcome?.ok) return;
    const timer = window.setTimeout(() => setSaveOutcome(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveOutcome]);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isFormControl =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "/" && !isFormControl) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedPlaylists = useMemo(
    () => Array.from(selectedIds).map((id) => playlists.find((playlist) => playlist.id === id)).filter((playlist): playlist is PlaylistOption => Boolean(playlist)),
    [playlists, selectedIds],
  );
  const selectedServices = new Set(selectedPlaylists.map((playlist) => playlist.service));
  const canSave = selectedPlaylists.length >= 2 && selectedServices.size === selectedPlaylists.length;
  const hiddenCount = playlists.filter((playlist) => playlist.service === activeService && playlist.hidden).length;
  const nextMissingService = SERVICES.find((service) => !selectedServices.has(service));
  const activePlaylists = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = playlists.filter((playlist) => {
      if (playlist.service !== activeService) return false;
      if (!showHidden && playlist.hidden) return false;
      if (!needle) return true;
      return playlist.name.toLowerCase().includes(needle);
    });
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    rows.sort((a, b) => {
      const ap = pinnedIds.has(a.id) ? 0 : 1;
      const bp = pinnedIds.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return collator.compare(a.name, b.name);
    });
    return rows;
  }, [activeService, playlists, showHidden, query, pinnedIds]);

  function nextServiceForSelection(ids: Set<string>, currentService: string): string | null {
    const chosenServices = new Set(
      Array.from(ids)
        .map((id) => playlists.find((playlist) => playlist.id === id)?.service)
        .filter((service): service is string => Boolean(service)),
    );
    const currentIndex = SERVICES.indexOf(currentService);
    const ordered = [...SERVICES.slice(currentIndex + 1), ...SERVICES.slice(0, currentIndex + 1)];
    return ordered.find((service) => !chosenServices.has(service)) || null;
  }

  function toggleSelected(playlist: PlaylistOption) {
    setSaveOutcome(null);
    setOpenMenuId(null);
    if (playlist.groupId && !selectedIds.has(playlist.id)) {
      const groupIds = playlists.filter((item) => item.groupId === playlist.groupId).map((item) => item.id);
      if (groupIds.length > 1) {
        setSelectedIds(new Set(groupIds));
        return;
      }
    }
    const willAdd = !selectedIds.has(playlist.id);
    const nextSelectedIds = new Set(selectedIds);
    if (willAdd) {
      for (const selected of playlists) {
        if (selected.service === playlist.service) nextSelectedIds.delete(selected.id);
      }
      nextSelectedIds.add(playlist.id);
    } else {
      nextSelectedIds.delete(playlist.id);
    }
    const nextService = willAdd ? nextServiceForSelection(nextSelectedIds, playlist.service) : null;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(playlist.id)) {
        next.delete(playlist.id);
        return next;
      }
      for (const selected of playlists) {
        if (selected.service === playlist.service) next.delete(selected.id);
      }
      next.add(playlist.id);
      return next;
    });
    if (nextService) setActiveService(nextService);
  }

  function togglePinned(playlist: PlaylistOption) {
    setOpenMenuId(null);
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(playlist.id)) next.delete(playlist.id);
      else next.add(playlist.id);
      try {
        localStorage.setItem("playlists:pinned", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }

  async function toggleHidden(playlist: PlaylistOption) {
    setOpenMenuId(null);
    const response = await fetch(`/api/playlists/${playlist.id}/hide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: !playlist.hidden }),
    });
    if (response.ok) startHideTransition(() => router.refresh());
  }

  async function saveGroup() {
    if (!canSave) {
      setSaveOutcome({ ok: false, message: "Choose 2 or 3 playlists, one per service." });
      return;
    }
    const [anchor, ...destinations] = selectedPlaylists;
    setSaving(true);
    setSaveOutcome(null);
    try {
      const response = await fetch("/api/playlist-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePlaylistId: anchor.id,
          destinationPlaylistIds: destinations.map((playlist) => playlist.id),
          name: selectedPlaylists.map((playlist) => playlist.name).join(" + "),
          mode: "ADD_ONLY",
          intervalMinutes: 60,
          isEnabled: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveOutcome({ ok: false, message: payload?.error || `Could not save (${response.status})` });
        return;
      }
      setSaveOutcome({ ok: true, message: "Playlist group saved." });
      router.refresh();
    } catch (error) {
      setSaveOutcome({ ok: false, message: error instanceof Error ? error.message : "Could not save group." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">
              <Layers3 size={14} />
              Playlist group
              </span>
              <span className="text-sm font-semibold text-white">{selectedPlaylists.length || 0}/3 selected</span>
              {!selectedPlaylists.length ? <span className="text-xs text-muted-fg">Pick matching playlists across services.</span> : null}
              {selectedPlaylists.length > 0 && nextMissingService && nextMissingService !== activeService ? (
                <button
                  type="button"
                  onClick={() => setActiveService(nextMissingService)}
                  className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold text-muted-fg transition hover:border-[var(--border)] hover:text-[var(--text)]"
                >
                  Next: {SERVICE_NAMES[nextMissingService]}
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-fg">
              {selectedPlaylists.length ? (
                selectedPlaylists.map((playlist) => (
                  <span key={playlist.id} className="pill">
                    <ServiceIcon service={playlist.service} size="sm" className="h-4 w-4" />
                    <span className="max-w-[10rem] truncate">{playlist.name}</span>
                  </span>
                ))
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {saveOutcome ? (
              <span className={`text-xs font-semibold ${saveOutcome.ok ? "text-emerald-300" : "text-rose-300"}`} role="status">
                {saveOutcome.message}
              </span>
            ) : null}
            {canSave ? (
              <button type="button" onClick={saveGroup} disabled={saving || selectedPlaylists.length < 2} className="btn btn-primary surface-lift">
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? "Saving" : "Save group"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div
        role="tablist"
        aria-label="Service"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-0"
      >
        {SERVICES.map((service) => {
          const meta = serviceMeta(service);
          const active = activeService === service;
          const count = playlists.filter((playlist) => playlist.service === service && !playlist.hidden).length;
          const selected = selectedPlaylists.find((playlist) => playlist.service === service);
          return (
            <button
              key={service}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveService(service)}
              className={`group relative flex min-w-[10.5rem] items-center justify-between gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition md:min-w-0 ${
                active ? `${meta.border} bg-[var(--surface-2)] text-white` : "border-[var(--border-soft)] bg-[var(--surface)] text-muted-fg"
              }`}
            >
              <span className={`absolute inset-y-2 left-0 w-1 rounded-r ${meta.bg}`} />
              <span className="flex min-w-0 items-center gap-2 pl-1">
                <ServiceIcon service={service} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{SERVICE_NAMES[service]}</span>
                  <span className="block truncate text-[11px] text-dim-fg">{selected ? selected.name : `${count} playlists`}</span>
                </span>
              </span>
              {selected ? <Check size={16} className="shrink-0 text-emerald-300" /> : <span className="text-xs tabular-nums text-dim-fg">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="surface-lift group/search relative min-w-0 flex-1 sm:max-w-md">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim-fg transition group-focus-within/search:text-[var(--accent)]"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Find ${SERVICE_NAMES[activeService]} playlist`}
            aria-label={`Find ${SERVICE_NAMES[activeService]} playlist`}
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] py-1.5 pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-dim-fg focus:border-[var(--accent)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-dim-fg transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowHidden((value) => !value)}
            className="surface-lift inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-muted-fg transition hover:border-[var(--border)] hover:text-[var(--text)]"
          >
            {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            {showHidden ? "Hide hidden" : `Show ${hiddenCount} hidden`}
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {activePlaylists.map((playlist) => {
          const meta = serviceMeta(playlist.service);
          const selected = selectedIds.has(playlist.id);
          const disabledByService = !selected && selectedServices.has(playlist.service);
          const linkedElsewhere = playlist.groupId && !selected;
          const pinned = pinnedIds.has(playlist.id);
          return (
            <article
              key={playlist.id}
              className={`group relative overflow-hidden rounded-xl border bg-[var(--surface)] p-3 shadow-[0_10px_28px_-24px_rgba(0,0,0,0.85)] transition ${
                selected ? `${meta.border} bg-[var(--surface-2)]` : "border-[var(--border-soft)] hover:border-[var(--border)]"
              }`}
            >
              <span className={`absolute inset-y-2 left-0 w-1 rounded-r ${meta.bg} ${selected ? "opacity-100" : "opacity-70"}`} />
              <div className="flex items-center gap-3 pl-1">
                <Artwork playlist={playlist} compact />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)] sm:text-base">{playlist.name}</h3>
                    {pinned ? <Star size={14} className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-fg">
                    <span className="tabular-nums text-[var(--text)]">{playlist.trackCount} tracks</span>
                    {playlist.isWritable ? null : <span className="rounded-md bg-amber-500/12 px-1.5 py-0.5 text-amber-200">read-only</span>}
                    {linkedElsewhere ? (
                      <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-emerald-200" title={playlist.groupName || "Linked group"}>
                        linked
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSelected(playlist)}
                  disabled={disabledByService}
                  className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
                    selected
                      ? "border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500"
                      : linkedElsewhere
                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "border-[var(--border-soft)] bg-[var(--surface-2)] text-[var(--text)] hover:border-[var(--border)]"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  title={disabledByService ? `Only one ${SERVICE_NAMES[playlist.service]} playlist can be in a group` : undefined}
                >
                  {selected ? <Check size={15} strokeWidth={3} /> : linkedElsewhere ? <Link2 size={15} /> : <Plus size={15} />}
                  <span className="hidden sm:inline">{selected ? "Selected" : linkedElsewhere ? "Open" : "Add"}</span>
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 pl-1">
                <Link href={`/playlists/${playlist.id}`} className="btn btn-ghost surface-lift px-3" title="Open songs" aria-label={`Open ${playlist.name} songs`}>
                  <ListMusic size={15} />
                  <span>Songs</span>
                </Link>
                <div className="relative ml-auto">
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((current) => (current === playlist.id ? null : playlist.id))}
                    className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-2)] p-2 text-dim-fg transition hover:border-[var(--border)] hover:text-[var(--text)]"
                    aria-expanded={openMenuId === playlist.id}
                    title="Playlist actions"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {openMenuId === playlist.id ? (
                    <div className="absolute bottom-11 right-0 z-20 w-36 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] shadow-[0_18px_60px_-28px_rgba(0,0,0,0.95)]">
                      <button
                        type="button"
                        onClick={() => togglePinned(playlist)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-muted-fg transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      >
                        <Star size={13} className={pinned ? "fill-[var(--accent)] text-[var(--accent)]" : ""} />
                        {pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleHidden(playlist)}
                        disabled={pendingHide}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-muted-fg transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
                      >
                        {playlist.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                        {playlist.hidden ? "Show" : "Hide"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!activePlaylists.length ? (
        <div className="panel p-6 text-center text-sm text-muted-fg">
          {query ? "No playlists match this search." : `No ${SERVICE_NAMES[activeService]} playlists to show.`}
        </div>
      ) : null}

      <div
        className={`pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] z-30 flex justify-center transition md:inset-x-6 md:bottom-6 ${
          selectedPlaylists.length ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
        aria-hidden={!selectedPlaylists.length}
      >
        <div className="pointer-events-auto panel flex w-full max-w-3xl flex-col gap-3 p-3 shadow-[0_18px_70px_-24px_rgba(0,0,0,0.9)] sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-fg">
              {canSave ? <Link2 size={12} /> : <Sparkles size={12} />}
              {canSave ? "Ready to link" : "Choose another service"}
            </div>
            <p className="truncate text-sm text-muted-fg">
              <span className="font-semibold text-[var(--text)]">{selectedPlaylists.length}</span> selected
              {selectedPlaylists.length ? (
                <span className="ml-1">
                  / {selectedPlaylists.map((playlist) => SERVICE_NAMES[playlist.service]).join(" + ")}
                </span>
              ) : null}
            </p>
          </div>
          <button type="button" onClick={saveGroup} disabled={!canSave || saving} className="btn btn-primary surface-lift">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Link2 size={16} />}
            {saving ? "Saving" : "Link playlists"}
          </button>
        </div>
      </div>
    </div>
  );
}
