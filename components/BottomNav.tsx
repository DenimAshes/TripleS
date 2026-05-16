"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Gauge, ListMusic, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Home", icon: Gauge },
  { href: "/playlists", label: "Lists", icon: ListMusic },
  { href: "/manual-match", label: "Review", icon: Shuffle },
  { href: "/history", label: "History", icon: Clock3 },
  { href: "/settings", label: "Rules", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--border-soft)] bg-[var(--surface)]/95 backdrop-blur md:hidden">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
              active ? "text-[var(--accent)]" : "text-muted-fg hover:text-[var(--text)]"
            }`}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
