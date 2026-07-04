"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Gauge, KeyRound, ListMusic, PlugZap, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/connections", label: "Connections", icon: PlugZap },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/manual-match", label: "Review songs", icon: Shuffle },
  { href: "/history", label: "History", icon: Clock3 },
  { href: "/settings", label: "Sync groups", icon: Settings },
];

const opsItems = [
  { href: "/admin/sessions", label: "Admin sessions", icon: KeyRound },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-[#0a0b10] px-4 py-6 md:flex">
      <div className="mb-10 flex items-center gap-3 px-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white font-black shadow-[0_0_20px_rgba(37,99,235,0.4)]">
          S
        </div>
        <div>
          <div className="text-base font-black tracking-tight text-white">TripleS</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Playlist sync</div>
        </div>
      </div>
      <nav className="space-y-1.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300 ${
                active
                  ? "bg-gradient-to-r from-[var(--accent-soft)] to-transparent text-[var(--text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                  : "text-text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              <item.icon
                size={18}
                className={active ? "text-[var(--accent)] transition-transform" : "text-dim-fg group-hover:text-[var(--text)]"}
                strokeWidth={active ? 2.5 : 2}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-8">
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-600">Ops</div>
        <nav className="space-y-1.5">
          {opsItems.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-r from-[var(--accent-soft)] to-transparent text-[var(--text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                    : "text-text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
              >
                <item.icon
                  size={18}
                  className={active ? "text-[var(--accent)] transition-transform" : "text-dim-fg group-hover:text-[var(--text)]"}
                  strokeWidth={active ? 2.5 : 2}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto pt-6">
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-[10px]">
          <div className="absolute -right-4 -bottom-4 h-12 w-12 rounded-full bg-blue-500/10 blur-xl" />
          <div className="relative z-10 text-blue-400 font-black uppercase tracking-widest">Workspace</div>
          <div className="relative z-10 mt-2 leading-relaxed text-slate-500 font-medium italic">
            Spotify, YouTube Music and SoundCloud in one place.
          </div>
        </div>
      </div>
    </aside>
  );
}
