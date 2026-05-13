"use client";

import Link from "next/link";
import { Clock3, Gauge, ListMusic, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Home", icon: Gauge },
  { href: "/playlists", label: "Lists", icon: ListMusic },
  { href: "/settings", label: "Rules", icon: Settings },
  { href: "/manual-match", label: "Review", icon: Shuffle },
  { href: "/history", label: "History", icon: Clock3 },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[#deded8] bg-white md:hidden">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="flex h-16 flex-col items-center justify-center gap-1 text-xs">
          <item.icon size={18} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
