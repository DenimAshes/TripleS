import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/services/adapterFactory";

// Finds playlists that TripleS created on a remote service but which never
// received any tracks via sync. Safe to remove because:
//   - createdBySystem=true means we created it (user didn't make it by hand)
//   - trackCount=0 means no tracks were ever added
//   - no PlaylistTrackState rows means we never wrote anything to it
//   - createdAt older than a buffer (default 1 hour) avoids racing fresh runs
//
// Default mode: list only. Pass --apply to actually delete from the service
// and remove the DB row. Pass --hours=N to override the age buffer.

function parseFlags() {
  const apply = process.argv.includes("--apply");
  const hoursArg = process.argv.find((arg) => arg.startsWith("--hours="));
  const hours = hoursArg ? Number(hoursArg.slice("--hours=".length)) : 1;
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid --hours value: ${hoursArg}`);
  }
  return { apply, hours };
}

async function main() {
  const { apply, hours } = parseFlags();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  console.log(`[cleanup] mode=${apply ? "APPLY" : "DRY-RUN"} olderThan=${hours}h (cutoff=${cutoff.toISOString()})`);

  const candidates = await prisma.playlist.findMany({
    where: {
      createdBySystem: true,
      trackCount: 0,
      createdAt: { lt: cutoff },
    },
    include: {
      _count: { select: { trackStates: true, groupMembers: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const orphans = candidates.filter((row) => row._count.trackStates === 0);
  console.log(`[cleanup] found ${orphans.length} orphan(s) (of ${candidates.length} createdBySystem+empty)`);

  if (!orphans.length) return;

  for (const row of orphans) {
    const tag = `${row.service}:${row.servicePlaylistId} (${row.name})`;
    if (!apply) {
      console.log(`  [DRY] would delete ${tag} createdAt=${row.createdAt.toISOString()} groupMembers=${row._count.groupMembers}`);
      continue;
    }
    let serviceDeleted = false;
    try {
      const adapter = getAdapter(row.service, row.userId);
      if (typeof adapter.deletePlaylist === "function") {
        const result = await adapter.deletePlaylist(row.servicePlaylistId);
        serviceDeleted = result.deleted;
      } else {
        console.log(`  [SKIP-SERVICE] ${row.service} adapter has no deletePlaylist; will only remove DB row`);
      }
    } catch (error) {
      console.warn(`  [WARN] delete on service failed for ${tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await prisma.playlistGroupMember.deleteMany({ where: { playlistId: row.id } });
    await prisma.playlistTrackState.deleteMany({ where: { playlistId: row.id } });
    await prisma.playlist.delete({ where: { id: row.id } });
    console.log(`  [OK] removed ${tag} serviceDeleted=${serviceDeleted}`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to actually delete. Optional: --hours=<n> to change the age buffer (default 1h).");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
