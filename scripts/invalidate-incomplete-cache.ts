import { prisma } from "@/lib/db/prisma";

const TOLERANCE = Math.max(
  0,
  Math.min(0.5, Number(process.env.WORKER_SNAPSHOT_PARTIAL_TOLERANCE ?? 0.1)),
);

type Mode = "report" | "reset";

function parseMode(): Mode {
  if (process.argv.includes("--reset")) return "reset";
  return "report";
}

async function main() {
  const mode = parseMode();
  const playlists = await prisma.playlist.findMany({
    select: {
      id: true,
      service: true,
      servicePlaylistId: true,
      name: true,
      trackCount: true,
      lastFetchedAt: true,
    },
  });

  const incomplete: Array<{
    id: string;
    service: string;
    servicePlaylistId: string;
    name: string;
    declared: number;
    active: number;
    lastFetchedAt: Date | null;
  }> = [];

  for (const playlist of playlists) {
    const active = await prisma.playlistTrackState.count({
      where: { playlistId: playlist.id, removedAt: null },
    });
    const declared = playlist.trackCount ?? 0;
    if (declared <= 0) continue;
    const dropRatio = (declared - active) / declared;
    if (dropRatio > TOLERANCE) {
      incomplete.push({
        id: playlist.id,
        service: playlist.service,
        servicePlaylistId: playlist.servicePlaylistId,
        name: playlist.name,
        declared,
        active,
        lastFetchedAt: playlist.lastFetchedAt,
      });
    }
  }

  if (!incomplete.length) {
    console.log("[invalidate-incomplete-cache] No incomplete playlists found.");
    return;
  }

  for (const playlist of incomplete) {
    console.log(
      `[incomplete] ${playlist.service}:${playlist.servicePlaylistId} "${playlist.name}" active=${playlist.active}/${playlist.declared} lastFetched=${playlist.lastFetchedAt?.toISOString() ?? "never"}`,
    );
  }

  if (mode === "reset") {
    const ids = incomplete.map((playlist) => playlist.id);
    const result = await prisma.playlist.updateMany({
      where: { id: { in: ids } },
      data: { lastFetchedAt: null },
    });
    console.log(`[invalidate-incomplete-cache] Reset lastFetchedAt=null for ${result.count} playlists.`);
  } else {
    console.log(`[invalidate-incomplete-cache] ${incomplete.length} playlists incomplete. Re-run with --reset to clear lastFetchedAt.`);
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
