import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { PlaylistSyncSelector, type PlaylistOption } from "@/components/PlaylistSyncSelector";
import { RefreshPlaylistsButton } from "@/components/RefreshPlaylistsButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

const NUMBER = new Intl.NumberFormat("en-GB");

export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string; service?: string; groupMode?: string; editGroup?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, groupMembers] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
    prisma.playlistGroupMember.findMany({
      where: { group: { userId: session!.userId } },
      include: { group: true },
    }),
  ]);
  const groupByPlaylistId = new Map(groupMembers.map((member) => [member.playlistId, member.group]));

  const playlistIds = playlists.map((playlist) => playlist.id);
  const coverRows = playlistIds.length
    ? await prisma.$queryRaw<Array<{ playlistId: string; imageUrl: string | null }>>`
        SELECT "playlistId", "imageUrl"
        FROM (
          SELECT
            pts."playlistId",
            st."imageUrl",
            row_number() OVER (
              PARTITION BY pts."playlistId"
              ORDER BY pts."position" ASC NULLS LAST, pts."id" ASC
            ) AS rn
          FROM "PlaylistTrackState" pts
          JOIN "ServiceTrack" st ON st."id" = pts."serviceTrackId"
          WHERE pts."playlistId" IN (${Prisma.join(playlistIds)})
            AND pts."removedAt" IS NULL
            AND st."imageUrl" IS NOT NULL
        ) ranked
        WHERE rn <= 12
        ORDER BY "playlistId" ASC, rn ASC
      `
    : [];
  const coverImagesByPlaylist = new Map<string, string[]>();
  for (const row of coverRows) {
    const imageUrl = row.imageUrl;
    if (!imageUrl) continue;
    const images = coverImagesByPlaylist.get(row.playlistId) || [];
    if (images.length < 4 && !images.includes(imageUrl)) {
      images.push(imageUrl);
      coverImagesByPlaylist.set(row.playlistId, images);
    }
  }

  const selectedRule = params.rule ? rules.find((rule) => rule.id === params.rule) : undefined;
  const initialService = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"].includes(params.service || "") ? params.service : undefined;
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
    coverImages: coverImagesByPlaylist.get(playlist.id) || [],
    hidden: playlist.hidden,
    groupId: groupByPlaylistId.get(playlist.id)?.id ?? null,
    groupName: groupByPlaylistId.get(playlist.id)?.name ?? null,
  }));

  const visibleTotal = playlistOptions.filter((p) => !p.hidden).length;
  const trackTotal = playlistOptions.filter((p) => !p.hidden).reduce((sum, p) => sum + (p.trackCount || 0), 0);
  const enabledRules = rules.filter((rule) => rule.isEnabled).length;

  return (
    <AppShell
      title="Playlists"
      description="Browse your music first. Switch to group mode only when you want to link matching playlists across services."
      actions={<RefreshPlaylistsButton />}
    >
      <PlaylistsAutoRefresh hasPlaylists={playlistOptions.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line-soft pb-4 text-sm text-muted-fg">
        <span><strong className="font-semibold tabular-nums text-[var(--text)]">{visibleTotal}</strong> playlists</span>
        <span><strong className="font-semibold tabular-nums text-[var(--text)]">{NUMBER.format(trackTotal)}</strong> songs</span>
        <span><strong className="font-semibold tabular-nums text-[var(--text)]">{enabledRules}</strong> active copies</span>
      </div>
      <PlaylistSyncSelector
        playlists={playlistOptions}
        rule={selectedRule}
        initialService={initialService}
        initialGroupMode={params.groupMode === "1"}
        initialGroupId={params.editGroup}
      />
    </AppShell>
  );
}
