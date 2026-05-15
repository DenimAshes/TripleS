import { prisma } from "@/lib/db/prisma";

type Args = {
  apply: boolean;
  playlistId?: string;
  service?: string;
  ruleId?: string;
  staleHours?: number;
};

function parseArgs(): Args {
  const args: Args = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--playlist=")) args.playlistId = arg.slice("--playlist=".length);
    else if (arg.startsWith("--service=")) args.service = arg.slice("--service=".length).toUpperCase();
    else if (arg.startsWith("--rule=")) args.ruleId = arg.slice("--rule=".length);
    else if (arg.startsWith("--stale-hours=")) args.staleHours = Math.max(1, Number(arg.slice("--stale-hours=".length)) || 24);
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const where: { service?: string; servicePlaylistId?: string } = {};
  if (args.playlistId) where.servicePlaylistId = args.playlistId;
  if (args.service) where.service = args.service;
  if (args.ruleId) {
    const rule = await prisma.syncRule.findUnique({ where: { id: args.ruleId } });
    if (!rule) throw new Error(`SyncRule ${args.ruleId} not found.`);
    where.service = rule.sourceService;
    where.servicePlaylistId = rule.sourcePlaylistId;
  }

  const playlists = await prisma.playlist.findMany({ where });
  const incomplete: Array<{ playlist: (typeof playlists)[number]; activeStates: number; stale: boolean }> = [];

  for (const playlist of playlists) {
    const activeStates = await prisma.playlistTrackState.count({
      where: { playlistId: playlist.id, removedAt: null },
    });
    const expected = playlist.trackCount ?? 0;
    const stale =
      args.staleHours && playlist.lastFetchedAt
        ? Date.now() - playlist.lastFetchedAt.getTime() > args.staleHours * 3_600_000
        : false;
    if ((expected > 0 && activeStates !== expected) || stale) {
      incomplete.push({ playlist, activeStates, stale });
    }
  }

  if (incomplete.length === 0) {
    console.log("[sync-cache-invalidate] No playlists need invalidation.");
    return;
  }

  for (const { playlist, activeStates, stale } of incomplete) {
    const expected = playlist.trackCount ?? 0;
    console.log(
      `${args.apply ? "[apply]" : "[dry-run]"} ${playlist.service}:${playlist.servicePlaylistId} (${playlist.name}) - active=${activeStates}, expected=${expected}, stale=${stale}, lastFetchedAt=${playlist.lastFetchedAt?.toISOString() ?? "never"}`,
    );
    if (!args.apply) continue;
    const now = new Date();
    await prisma.playlistTrackState.updateMany({
      where: { playlistId: playlist.id, removedAt: null },
      data: { removedAt: now },
    });
    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { lastFetchedAt: null },
    });
  }

  if (!args.apply) {
    console.log("\nDry-run only. Re-run with --apply to actually invalidate.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
