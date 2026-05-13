import Link from "next/link";
import { Clock3, Gauge, ListMusic, Settings, Shuffle } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Home", icon: Gauge },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/history", label: "History", icon: Clock3 },
  { href: "/manual-match", label: "Review songs", icon: Shuffle },
];

export function AppSidebar() {
  return (
    <aside className="hidden min-h-screen w-64 border-r border-[#deded8] bg-white px-4 py-5 md:block">
      <div className="mb-8">
        <div className="text-xl font-semibold">TripleS</div>
        <div className="text-sm text-[#666a73]">Playlist manager</div>
      </div>
      <nav className="space-y-1">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-[#f0f0ec]">
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
