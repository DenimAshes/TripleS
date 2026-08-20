"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Gauge, KeyRound, ListMusic, PlugZap, Settings, Shuffle } from "lucide-react";
import { SoundCloudGlyph, YouTubeGlyph } from "./ServiceBrand";

type NavIcon = (props: { size: number }) => React.ReactNode;
type NavItem = { href: string; label: string; icon: NavIcon };

const SECTIONS: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/connections", label: "Connections", icon: PlugZap },
      { href: "/playlists", label: "Playlists", icon: ListMusic },
      { href: "/manual-match", label: "Review songs", icon: Shuffle },
      { href: "/history", label: "History", icon: Clock3 },
      { href: "/settings", label: "Sync groups", icon: Settings },
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
    <aside className="hidden min-h-screen w-60 shrink-0 flex-col border-r border-line-soft bg-[var(--bg)] px-3 py-6 md:flex">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-accent text-[var(--on-accent)] text-sm font-bold">
          S
        </span>
        <span className="text-sm font-semibold tracking-tight text-[var(--text)]">TripleS</span>
      </Link>

      {SECTIONS.map((section, index) => (
        <nav key={section.title ?? "main"} className={index > 0 ? "mt-7" : undefined}>
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
                    className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 text-sm transition-colors ${
                      active
                        ? "bg-surface-2 font-medium text-[var(--text)]"
                        : "text-muted-fg hover:bg-surface-2 hover:text-[var(--text)]"
                    }`}
                  >
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
    </aside>
  );
}
