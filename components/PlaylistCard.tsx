import Link from "next/link";
import type { Playlist } from "@prisma/client";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <Link href={`/playlists/${playlist.id}`} className="panel group block p-5 transition-all duration-200 hover:border-[var(--border-accent)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">{playlist.name}</h3>
          <p className="mt-1 text-sm text-muted-fg truncate">{playlist.description || "No description"}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--text)] border border-[var(--border-soft)]">
          {playlist.trackCount}
        </div>
      </div>
    </Link>
  );
}
