import { AppShell } from "@/components/AppShell";
import { PlaylistsAutoRefresh } from "@/components/PlaylistsAutoRefresh";
import { ServiceCard } from "@/components/ServiceCard";
import { SessionStalenessBanner, classifySession, type SessionStaleness } from "@/components/SessionStalenessBanner";
import { SyncRuleCard } from "@/components/SyncRuleCard";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

const WORKER_SERVICES = ["youtube", "spotify", "soundcloud"] as const;

export default async function DashboardPage() {
  const session = await getSession();
  const [accounts, rules, lastJob, playlists, sessionRows] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId: session!.userId }, orderBy: { service: "asc" } }),
    prisma.syncRule.findMany({ where: { userId: session!.userId }, include: { destinations: true }, orderBy: { createdAt: "asc" } }),
    prisma.syncJob.findFirst({ where: { syncRule: { userId: session!.userId } }, orderBy: { startedAt: "desc" } }),
    prisma.playlist.findMany({ where: { userId: session!.userId }, select: { updatedAt: true } }),
    prisma.workerSessionState.findMany({ where: { service: { in: WORKER_SERVICES as unknown as string[] } } }),
  ]);
  const sessionByService = new Map(sessionRows.map((row) => [row.service, row]));
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const staleSessions: SessionStaleness[] = WORKER_SERVICES.flatMap((service) => {
    const row = sessionByService.get(service);
    const classified = classifySession({ service, exists: !!row, updatedAt: row?.updatedAt ?? null }, now);
    return classified ? [classified] : [];
  });
  const stats = lastJob ? JSON.parse(lastJob.statsJson) : { synced: 0, alreadySynced: 0, notFound: 0, manualRequired: 0 };
  const lastChangedAt = playlists.reduce<Date | null>(
    (latest, playlist) => (!latest || playlist.updatedAt > latest ? playlist.updatedAt : latest),
    null,
  );

  return (
    <AppShell title="Home">
      <PlaylistsAutoRefresh hasPlaylists={playlists.length > 0} lastChangedAt={lastChangedAt?.toISOString() || null} />
      <SessionStalenessBanner items={staleSessions} />
      <div className="grid gap-4 md:grid-cols-3">
        {["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"].map((service) => {
          const account = accounts.find((item) => item.service === service);
          return (
            <ServiceCard
              key={service}
              name={service}
              username={account?.serviceUsername}
              isMock={account?.isMock}
              connectionStatus={account?.connectionStatus}
              lastError={account?.lastError}
            />
          );
        })}
      </div>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Playlist copies</h2>
        {rules.map((rule) => <SyncRuleCard key={rule.id} rule={rule} />)}
      </section>

      <section className="mt-6 panel p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Latest activity</h2>
            <p className="mt-1 text-sm text-[#666a73]">{lastJob ? lastJob.finishedAt?.toLocaleString() || lastJob.startedAt.toLocaleString() : "No activity yet"}</p>
          </div>
          {lastJob ? <StatusBadge status={lastJob.status.toLowerCase()} /> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.synced}</div><div className="text-sm text-[#666a73]">added</div></div>
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.alreadySynced || 0}</div><div className="text-sm text-[#666a73]">already there</div></div>
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.notFound}</div><div className="text-sm text-[#666a73]">not found</div></div>
          <div className="rounded-md bg-[#f0f0ec] p-3"><div className="text-2xl font-semibold">{stats.manualRequired}</div><div className="text-sm text-[#666a73]">review</div></div>
        </div>
      </section>
    </AppShell>
  );
}
