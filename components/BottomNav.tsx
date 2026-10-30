"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Clock3,
  Gauge,
  KeyRound,
  ListMusic,
  LogOut,
  MoreHorizontal,
  PlugZap,
  Settings,
  Shuffle,
  X,
} from "lucide-react";
import { isActivePath } from "./AppSidebar";
import { SoundCloudGlyph, YouTubeGlyph } from "./ServiceBrand";

const PRIMARY = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/manual-match", label: "Review", icon: Shuffle },
  { href: "/settings", label: "Groups", icon: Settings },
];

// Five slots can't hold nine pages, so everything that didn't fit used to be
// unreachable on a phone. It lives here instead of nowhere.
const MORE = [
  { href: "/connections", label: "Connections", icon: PlugZap },
  { href: "/history", label: "Activity", icon: Clock3 },
  { href: "/youtube-browser", label: "YouTube Music tools", icon: YouTubeGlyph },
  { href: "/soundcloud-browser", label: "SoundCloud tools", icon: SoundCloudGlyph },
  { href: "/admin/sessions", label: "Admin sessions", icon: KeyRound },
];

export function BottomNav() {
  const pathname = usePathname();
  // Which route the sheet was opened on, rather than a bare boolean: navigating
  // away then closes it by derivation instead of needing an effect to reset it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor !== null && openFor === pathname;
  const setOpen = (next: boolean) => setOpenFor(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const moreActive = MORE.some((item) => isActivePath(pathname, item.href));

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[var(--scrim)]"
          />
          <nav
            id="mobile-more-menu"
            aria-labelledby="mobile-more-title"
            className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] mx-3 overflow-hidden overscroll-contain rounded-[var(--radius)] border border-line-soft bg-[var(--surface)]"
          >
            <div className="panel-header flex items-center justify-between">
              <h2 id="mobile-more-title" className="heading-row">More</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="btn btn-ghost btn-icon text-muted-fg">
                <X size={16} />
              </button>
            </div>
            <ul className="p-2">
              {MORE.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm ${
                        active ? "bg-surface-2 font-medium text-[var(--text)]" : "text-muted-fg"
                      }`}
                    >
                      <span className={active ? "text-accent" : "text-dim-fg"}>
                        <item.icon size={16} />
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <form action="/api/auth/logout" method="post" className="border-t border-line-soft p-2">
              <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm text-muted-fg">
                <LogOut size={16} className="text-dim-fg" />
                Sign out
              </button>
            </form>
          </nav>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line-soft bg-[var(--sidebar)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {PRIMARY.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
                active ? "text-accent" : "text-muted-fg"
              }`}
            >
              <item.icon size={20} strokeWidth={active ? 2.4 : 2} />
              <span className="leading-none">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="mobile-more-menu"
          className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
            open || moreActive ? "text-accent" : "text-muted-fg"
          }`}
        >
          <MoreHorizontal size={20} />
          <span className="leading-none">More</span>
        </button>
      </nav>
    </>
  );
}
