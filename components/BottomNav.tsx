"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, ListMusic, PlugZap, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Home", icon: Gauge },
  { href: "/connections", label: "Connect", icon: PlugZap },
  { href: "/playlists", label: "Lists", icon: ListMusic },
  { href: "/manual-match", label: "Review", icon: Shuffle },
  { href: "/settings", label: "Sync", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--border-soft)] bg-gradient-to-t from-[var(--surface)] to-[var(--surface)]/95 backdrop-blur-lg md:hidden">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex h-16 flex-col items-center justify-center gap-1.5 text-[11px] font-semibold transition-all duration-200 ${
              active 
                ? "text-[var(--accent)] bg-gradient-to-t from-[var(--accent-soft)] to-transparent" 
                : "text-muted-fg hover:text-[var(--text)]"
            }`}
          >
            <item.icon 
              size={22} 
              className={active ? "transition-transform" : "group-hover:scale-110"}
              strokeWidth={active ? 2.5 : 2}
            />
            <span className="leading-none">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
