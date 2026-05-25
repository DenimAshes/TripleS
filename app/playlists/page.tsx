import { ListMusic } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { PlaylistSyncSelector, type PlaylistOption, type ServiceStatus } from "@/components/PlaylistSyncSelector";
import { RefreshPlaylistsButton } from "@/components/RefreshPlaylistsButton";
import { ServiceIcon, serviceMeta } from "@/components/ServiceBrand";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";

const SERVICES = ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"] as const;

export default async function PlaylistsPage({ searchParams }: { searchParams: Promise<{ rule?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, accounts, groupMembers] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
    prisma.connectedAccount.findMany({ where: { userId: session!.userId } }),
    prisma.playlistGroupMember.findMany({
      where: { group: { userId: session!.userId } },
      include: { group: true },
    }),
  ]);
  const groupByPlaylistId = new Map(groupMembers.map((member) => [member.playlistId, member.group]));

  const accountByService = new Map(accounts.map((account) => [account.service, account]));
  const serviceStatuses: Record<string, ServiceStatus> = {};
  for (const service of SERVICES) {
    const account = accountByService.get(service);
    const visiblePlaylists = playlists.filter((p) => p.service === service && !p.hidden);
    const hiddenCount = playlists.filter((p) => p.service === service && p.hidden).length;
    const lastFetched = playlists
      .filter((p) => p.service === service)
      .reduce<Date | null>(
        (latest, p) => (!p.lastFetchedAt ? latest : !latest || p.lastFetchedAt > latest ? p.lastFetchedAt : latest),
        null,
      );

    serviceStatuses[service] = {
      service,
      connected: Boolean(account) && account!.connectionStatus !== "NEEDS_LOGIN" && !account!.isMock,
      connectionStatus: account?.connectionStatus ?? null,
      isMock: account?.isMock ?? false,
      lastError: account?.lastError ?? null,
      playlistCount: visiblePlaylists.length,
      hiddenCount,
      lastFetchedAt: lastFetched ? lastFetched.toISOString() : null,
    };
  }

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
    <AppShell title="Playlists">
      <PlaylistsAutoRefresh hasPlaylists={playlistOptions.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />

      <div className="space-y-4 md:space-y-5">
        <section className="flex flex-col gap-3 border-y border-[var(--border-soft)] py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-accent">
              <ListMusic size={13} />
              {visibleTotal} playlists
            </span>
            <span className="pill">{trackTotal.toLocaleString()} tracks</span>
            <span className="pill">{enabledRules}/{rules.length} rules on</span>
            {SERVICES.map((service) => {
              const status = serviceStatuses[service];
              const meta = serviceMeta(service);
              return (
                <a
                  key={service}
                  href={`#playlists-${service.toLowerCase()}`}
                  className={`pill ${status.connected ? meta.soft : "pill-warning"}`}
                  title={status.lastError || `${status.playlistCount} playlists`}
                >
                  <ServiceIcon service={service} size="sm" className="h-4 w-4" />
                  {status.playlistCount}
                </a>
              );
            })}
          </div>
          <RefreshPlaylistsButton />
        </section>

        <PlaylistSyncSelector playlists={playlistOptions} rule={selectedRule} serviceStatuses={serviceStatuses} />
      </div>
    </AppShell>
  );
}
