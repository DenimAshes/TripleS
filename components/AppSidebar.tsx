"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Gauge, KeyRound, ListMusic, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Home", icon: Gauge },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/manual-match", label: "Review songs", icon: Shuffle },
  { href: "/history", label: "History", icon: Clock3 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin/sessions", label: "Worker sessions", icon: KeyRound },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--surface)] px-4 py-6 md:flex">
      <div className="mb-10 flex items-center gap-3 px-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-[#0a0b10] font-bold">
          S
        </div>
        <div>
          <div className="text-base font-semibold leading-tight">TripleS</div>
          <div className="text-xs text-dim-fg leading-tight">Playlist sync</div>
        </div>
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                  : "text-muted-fg hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              <item.icon
                size={18}
                className={active ? "text-[var(--accent)]" : "text-dim-fg group-hover:text-[var(--text)]"}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-6 text-xs text-dim-fg">
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
          <div className="text-[var(--text-muted)] font-medium">v0.1</div>
          <div className="mt-1 leading-relaxed">
            Sync your music across Spotify, YouTube and SoundCloud.
          </div>
        </div>
      </div>
    </aside>
  );
}
