import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { PlaylistSyncSelector, type PlaylistOption } from "@/components/PlaylistSyncSelector";
import { RefreshPlaylistsButton } from "@/components/RefreshPlaylistsButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function PlaylistsPage({ searchParams }: { searchParams: Promise<{ rule?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const selectedRule = rules.find((rule) => rule.id === params.rule) || rules[0];
  const lastChangedAt = playlists.reduce<Date | null>(
    (latest, playlist) => (!latest || playlist.updatedAt > latest ? playlist.updatedAt : latest),
    null,
  );
  const playlistOptions: PlaylistOption[] = playlists.map((playlist) => ({
    id: playlist.id,
    service: playlist.service,
    servicePlaylistId: playlist.servicePlaylistId,
    name: playlist.name,
    description: playlist.description,
    trackCount: playlist.trackCount,
    isWritable: playlist.isWritable,
    imageUrl: playlist.imageUrl,
    hidden: playlist.hidden,
  }));

  return (
    <AppShell title="Playlists">
      <PlaylistsAutoRefresh hasPlaylists={playlistOptions.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-accent-fg uppercase tracking-wider">
          {selectedRule ? selectedRule.name : "Create new sync"}
        </div>
        <RefreshPlaylistsButton />
      </div>
      <PlaylistSyncSelector playlists={playlistOptions} rule={selectedRule} />
    </AppShell>
  );
}
