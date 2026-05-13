import Link from "next/link";
import type { Playlist } from "@prisma/client";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <Link href={`/playlists/${playlist.id}`} className="panel block p-4 transition hover:border-[#18181b]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">{playlist.name}</h3>
          <p className="mt-1 text-sm text-[#666a73]">{playlist.description || "No description"}</p>
        </div>
        <div className="rounded-md bg-[#f0f0ec] px-2 py-1 text-xs">{playlist.trackCount} tracks</div>
      </div>
    </Link>
  );
}
