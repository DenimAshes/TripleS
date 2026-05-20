import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { PlaylistSyncSelector, type PlaylistOption, type ServiceStatus } from "@/components/PlaylistSyncSelector";
import { RefreshPlaylistsButton } from "@/components/RefreshPlaylistsButton";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function PlaylistsPage({ searchParams }: { searchParams: Promise<{ rule?: string }> }) {
  const session = await getSession();
  const params = await searchParams;
  const [playlists, rules, accounts] = await Promise.all([
    prisma.playlist.findMany({ where: { userId: session!.userId }, orderBy: [{ service: "asc" }, { name: "asc" }] }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "desc" } }),
    prisma.connectedAccount.findMany({ where: { userId: session!.userId } }),
  ]);
  const accountByService = new Map(accounts.map((account) => [account.service, account]));
  const serviceStatuses: Record<string, ServiceStatus> = {};
  for (const service of ["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"] as const) {
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
      <PlaylistSyncSelector playlists={playlistOptions} rule={selectedRule} serviceStatuses={serviceStatuses} />
    </AppShell>
  );
}
