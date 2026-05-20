import { prisma } from "@/lib/db/prisma";
import { getAdapter } from "@/lib/services/adapterFactory";

// One-shot cleanup for the smoke-test artifacts left behind during dev:
//   - The "тестовый" SoundCloud playlist we created via connectPlaylistGroup
//     (createdBySystem=true, no real content)
//   - The SyncRule + PlaylistGroup that wired the YT "тестовый" -> SC
//     "тестовый" pair
//   - Pending ManualMatchCandidate rows pointing at deleted/test tracks
//
// Run with --apply to actually delete. Default is dry run.

function parseFlags() {
  return { apply: process.argv.includes("--apply") };
}

async function main() {
  const { apply } = parseFlags();
  console.log(`[cleanup-test] mode=${apply ? "APPLY" : "DRY-RUN"}`);

  // 1) SoundCloud "тестовый" playlist (createdBySystem)
  const scTest = await prisma.playlist.findMany({
    where: {
      service: "SOUNDCLOUD",
      OR: [{ name: { contains: "тестов", mode: "insensitive" } }, { servicePlaylistId: { contains: "testovyj" } }],
    },
  });
  console.log(`[cleanup-test] SC "тестовый" candidates: ${scTest.length}`);
  for (const playlist of scTest) {
    console.log(`  - ${playlist.id} (${playlist.servicePlaylistId}) trackCount=${playlist.trackCount} createdBySystem=${playlist.createdBySystem}`);
  }

  // 2) Sync rules whose name or source is "тестовый"
  const testRules = await prisma.syncRule.findMany({
    where: {
      OR: [
        { name: { contains: "тестов", mode: "insensitive" } },
        { sourcePlaylistId: { in: scTest.map((p) => p.servicePlaylistId) } },
      ],
    },
    include: { destinations: true },
  });
  const ytTestRules = await prisma.syncRule.findMany({
    where: { name: { contains: "тестов", mode: "insensitive" } },
    include: { destinations: true },
  });
  const allRules = [...testRules, ...ytTestRules].filter(
    (rule, index, arr) => arr.findIndex((r) => r.id === rule.id) === index,
  );
  console.log(`[cleanup-test] sync rules: ${allRules.length}`);
  for (const rule of allRules) {
    console.log(`  - ${rule.id} "${rule.name}" -> ${rule.destinations.map((d) => `${d.service}:${d.playlistId}`).join(", ")}`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to actually delete.");
    return;
  }

  // Delete in dependency order. Cascades on the DB handle most child rows.
  if (allRules.length) {
    await prisma.syncRule.deleteMany({ where: { id: { in: allRules.map((rule) => rule.id) } } });
  }
  for (const rule of allRules) {
    console.log(`[cleanup-test] removed sync rule ${rule.id}`);
  }

  const deletedPlaylists: typeof scTest = [];
  for (const playlist of scTest) {
    if (playlist.createdBySystem) {
      try {
        const adapter = getAdapter(playlist.service, playlist.userId);
        if (typeof adapter.deletePlaylist === "function") {
          await adapter.deletePlaylist(playlist.servicePlaylistId);
          console.log(`[cleanup-test] remote SC deleted ${playlist.servicePlaylistId}`);
        }
      } catch (error) {
        console.warn(
          `[cleanup-test] remote SC delete failed (best effort): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    deletedPlaylists.push(playlist);
    console.log(`[cleanup-test] removed playlist ${playlist.id}`);
  }
  if (deletedPlaylists.length) {
    const playlistIds = deletedPlaylists.map((playlist) => playlist.id);
    await prisma.playlistGroupMember.deleteMany({ where: { playlistId: { in: playlistIds } } });
    await prisma.playlistTrackState.deleteMany({ where: { playlistId: { in: playlistIds } } });
    await prisma.playlist.deleteMany({ where: { id: { in: playlistIds } } });
  }

  // Pending manual-match candidates that point at the deleted tracks have
  // already been removed by cascade. Anything left referencing now-missing
  // tracks would be visible in /manual-match as broken cards.

  // Orphaned playlist groups with no remaining members
  const emptyGroups = await prisma.playlistGroup.findMany({
    where: { members: { none: {} } },
  });
  if (emptyGroups.length) {
    await prisma.playlistGroup.deleteMany({ where: { id: { in: emptyGroups.map((group) => group.id) } } });
  }
  for (const group of emptyGroups) {
    console.log(`[cleanup-test] removed empty group ${group.id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
