"use client";

import {
  ArrowRight,
  Clock3,
  CornerDownLeft,
  Gauge,
  KeyRound,
  ListMusic,
  PlugZap,
  Search,
  Settings,
  Shuffle,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceIcon, SoundCloudGlyph, YouTubeGlyph } from "./ServiceBrand";

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Playlists" | "Actions";
  icon: React.ReactNode;
  href?: string;
  keywords?: string;
  run?: () => void;
};

const NAV_ITEMS: CommandItem[] = [
  { id: "nav-dashboard", group: "Navigate", icon: <Gauge size={15} />, label: "Dashboard", href: "/dashboard", hint: "Overview & last run" },
  { id: "nav-connections", group: "Navigate", icon: <PlugZap size={15} />, label: "Connections", href: "/connections", hint: "Spotify, YouTube, SoundCloud" },
  { id: "nav-playlists", group: "Navigate", icon: <ListMusic size={15} />, label: "Playlists", href: "/playlists", hint: "Pick a source & mirrors" },
  { id: "nav-review", group: "Navigate", icon: <Shuffle size={15} />, label: "Review songs", href: "/manual-match", hint: "Resolve uncertain matches" },
  { id: "nav-history", group: "Navigate", icon: <Clock3 size={15} />, label: "History", href: "/history", hint: "Logs & failures" },
  { id: "nav-rules", group: "Navigate", icon: <Settings size={15} />, label: "Sync groups", href: "/settings", hint: "Linked playlists & source controls" },
  { id: "nav-yt-tools", group: "Navigate", icon: <YouTubeGlyph size={15} />, label: "YouTube Music tools", href: "/youtube-browser", hint: "Browser session: read, search, add", keywords: "browser lab ytm automation" },
  { id: "nav-sc-tools", group: "Navigate", icon: <SoundCloudGlyph size={15} />, label: "SoundCloud tools", href: "/soundcloud-browser", hint: "Browser session: read, search, add", keywords: "browser lab sc automation" },
  { id: "nav-admin", group: "Navigate", icon: <KeyRound size={15} />, label: "Admin sessions", href: "/admin/sessions", hint: "Operator-only" },
];

const SERVICE_ITEMS: CommandItem[] = [
  {
    id: "svc-spotify",
    group: "Playlists",
    icon: <ServiceIcon service="SPOTIFY" size="sm" className="h-4 w-4" />,
    label: "Spotify playlists",
    href: "/playlists#playlists-spotify",
    keywords: "spotify green source",
  },
  {
    id: "svc-youtube",
    group: "Playlists",
    icon: <ServiceIcon service="YOUTUBE" size="sm" className="h-4 w-4" />,
    label: "YouTube Music playlists",
    href: "/playlists#playlists-youtube",
    keywords: "youtube ytm red",
  },
  {
    id: "svc-soundcloud",
    group: "Playlists",
    icon: <ServiceIcon service="SOUNDCLOUD" size="sm" className="h-4 w-4" />,
    label: "SoundCloud playlists",
    href: "/playlists#playlists-soundcloud",
    keywords: "soundcloud sc orange",
  },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }, []);

  const items: CommandItem[] = useMemo(() => {
    const actions: CommandItem[] = [
      {
        id: "act-refresh",
        group: "Actions",
        icon: <Sparkles size={15} />,
        label: "Refresh page data",
        hint: "Re-fetch current view",
        run: () => router.refresh(),
        keywords: "reload sync",
      },
    ];
    return [...NAV_ITEMS, ...SERVICE_ITEMS, ...actions];
  }, [router]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query]);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => {
          if (value) {
            setQuery("");
            setActiveIndex(0);
            return false;
          }
          setQuery("");
          setActiveIndex(0);
          return true;
        });
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        closePalette();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closePalette]);

  useEffect(() => {
    if (open) {
      const trigger = triggerRef.current;
      lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        document.body.style.overflow = previousOverflow;
        // Restore focus to whatever triggered the palette so keyboard users
        // don't get dumped at the top of the document.
        (lastFocusedRef.current ?? trigger)?.focus();
      };
    }
  }, [open]);

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index='${activeIndex}']`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function runItem(item: CommandItem) {
    if (item.run) item.run();
    if (item.href) router.push(item.href);
    closePalette();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(filtered.length - 1, idx + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(0, idx - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) runItem(item);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPalette}
        className="surface-lift group hidden items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-muted-fg transition hover:border-[var(--border)] hover:text-[var(--text)] sm:inline-flex"
        aria-label="Open command palette"
      >
        <Search size={13} className="text-dim-fg group-hover:text-[var(--accent)]" />
        <span>Jump...</span>
        <span className="ml-2 inline-flex items-center gap-0.5">
          <kbd className="kbd">Ctrl</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quick jump"
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[18vh]"
          onKeyDown={trapFocus}
        >
          <button
            type="button"
            aria-label="Close palette"
            onClick={closePalette}
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-[var(--scrim)] backdrop-blur-sm"
          />
          <div
            ref={dialogRef}
            className="panel relative w-full max-w-xl overflow-hidden border-[var(--border)] shadow-[var(--shadow-overlay)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4">
              <Search size={16} className="text-dim-fg" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Jump to a page, service, or action..."
                className="w-full border-0! bg-transparent! py-3 text-sm! text-[var(--text)]! shadow-none! outline-none placeholder:text-dim-fg"
              />
              <kbd className="kbd select-none">Esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-fg">
                  Nothing matches <span className="font-semibold text-[var(--text)]">&ldquo;{query}&rdquo;</span>.
                </div>
              ) : (
                renderGroups(filtered, activeIndex, runItem, setActiveIndex)
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-soft)] bg-[var(--surface-2)]/50 px-4 py-2 text-xs text-muted-fg">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="kbd">Up</kbd>
                  <kbd className="kbd">Down</kbd>
                  navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="kbd">
                    <CornerDownLeft size={10} />
                  </kbd>
                  open
                </span>
              </div>
              <Link
                href="/playlists"
                onClick={closePalette}
                className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] transition hover:text-[var(--accent-hover)]"
              >
                Playlists <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function renderGroups(items: CommandItem[], activeIndex: number, run: (item: CommandItem) => void, setActiveIndex: (n: number) => void) {
  const groups = new Map<string, Array<{ item: CommandItem; index: number }>>();
  items.forEach((item, index) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group)!.push({ item, index });
  });
  return Array.from(groups.entries()).map(([group, entries]) => (
    <div key={group} className="mb-1 last:mb-0">
      <div className="eyebrow px-3 pb-1 pt-2 text-muted-fg">{group}</div>
      <div className="space-y-0.5">
        {entries.map(({ item, index }) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              data-cmd-index={index}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(item)}
              className={`flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                  : "text-muted-fg hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }`}
            >
              <span className={active ? "text-[var(--accent)]" : "text-dim-fg"}>{item.icon}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.hint ? (
                <span className="hidden truncate text-xs text-dim-fg sm:inline">{item.hint}</span>
              ) : null}
              {active ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                  Go <CornerDownLeft size={10} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  ));
}
