"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Gauge, KeyRound, ListMusic, LogOut, PlugZap, Settings, Shuffle } from "lucide-react";
import { SoundCloudGlyph, YouTubeGlyph } from "./ServiceBrand";
import { TripleSMark } from "./TripleSMark";
import { HealthIndicator } from "./HealthIndicator";

type NavIcon = (props: { size: number }) => React.ReactNode;
type NavItem = { href: string; label: string; icon: NavIcon };

const SECTIONS: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: Gauge },
      { href: "/playlists", label: "Playlists", icon: ListMusic },
      { href: "/manual-match", label: "Review queue", icon: Shuffle },
      { href: "/settings", label: "Sync groups", icon: Settings },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/connections", label: "Connections", icon: PlugZap },
      { href: "/history", label: "Activity", icon: Clock3 },
    ],
  },
  {
    // These two pages existed but were reachable only from a button buried in a
    // card on /connections — not from the sidebar, the mobile nav or the
    // command palette.
    title: "Browser tools",
    items: [
      { href: "/youtube-browser", label: "YouTube Music", icon: YouTubeGlyph },
      { href: "/soundcloud-browser", label: "SoundCloud", icon: SoundCloudGlyph },
    ],
  },
  {
    title: "Ops",
    items: [{ href: "/admin/sessions", label: "Admin sessions", icon: KeyRound }],
  },
];

export function isActivePath(pathname: string | null, href: string) {
  return pathname === href || Boolean(pathname?.startsWith(href + "/"));
}

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line-soft bg-[var(--sidebar)] px-3 py-6 md:flex">
      <Link href="/dashboard" className="group mb-8 flex items-center gap-3 px-2">
        <TripleSMark size="md" className="transition-colors group-hover:border-[var(--accent)]" />
        <span className="min-w-0">
          <span translate="no" className="block text-base font-semibold tracking-[-0.025em] text-[var(--text)]">TripleS</span>
          <span className="block text-xs text-muted-fg">Playlist relay</span>
        </span>
      </Link>

      <div className="flex-1">
        {SECTIONS.map((section, index) => (
          <nav key={section.title ?? "main"} className={index > 0 ? "mt-7" : undefined} aria-label={section.title ?? "Workspace"}>
            {section.title ? (
              <div className="eyebrow px-2 pb-1.5 text-muted-fg">
                {section.title}
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center gap-2.5 overflow-hidden rounded-[var(--radius-sm)] px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-surface-2 font-medium text-[var(--text)]"
                          : "text-muted-fg hover:bg-surface-2 hover:text-[var(--text)]"
                      }`}
                    >
                      {active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
                      <span className={active ? "text-accent" : "text-dim-fg"}>
                        <item.icon size={16} />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mt-7 border-t border-line-soft px-2 pt-4">
        <HealthIndicator />
        <form action="/api/auth/logout" method="post" className="mt-3">
          <button type="submit" className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] py-2 text-sm text-muted-fg transition-colors hover:text-[var(--text)]">
            <LogOut size={15} className="text-dim-fg" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
