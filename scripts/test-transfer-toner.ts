import { prisma } from "@/lib/db/prisma";
import { connectPlaylistGroup } from "@/lib/services/playlistGroupActions";
import { syncPlaylistTracksToDb } from "@/lib/services/playlistTracksStore";
import { refreshServicePlaylists } from "@/lib/services/playlistRefresh";
import { serviceKey } from "@/lib/services/adapterFactory";
import { runSync } from "@/lib/sync/syncEngine";

const SOURCE_NAME = process.env.TEST_SOURCE_NAME || "тестовый";
const DEST_NAME = process.env.TEST_DEST_NAME || SOURCE_NAME;

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) throw new Error("No user in DB");
  console.log(`[test] user: ${user.email} (${user.id})`);

  let source = await prisma.playlist.findFirst({
    where: { userId: user.id, service: "YOUTUBE", name: { equals: SOURCE_NAME, mode: "insensitive" } },
  });
  if (!source) {
    console.log(`[test] source "${SOURCE_NAME}" not in DB; refreshing YouTube playlist list...`);
    await refreshServicePlaylists(user.id, "youtube");
    source = await prisma.playlist.findFirst({
      where: { userId: user.id, service: "YOUTUBE", name: { equals: SOURCE_NAME, mode: "insensitive" } },
    });
  }
  if (!source) throw new Error(`Source playlist "${SOURCE_NAME}" still not found on YouTube`);
  console.log(`[test] source: ${source.name} (${source.id}, trackCount=${source.trackCount})`);

  let rule = await prisma.syncRule.findFirst({
    where: { userId: user.id, sourcePlaylistId: source.servicePlaylistId },
    include: { destinations: true },
  });
  if (!rule) {
    console.log(`[test] creating destination SC playlist "${DEST_NAME}" + group + rule...`);
    const group = await connectPlaylistGroup(user.id, {
      sourcePlaylistId: source.id,
      createDestination: { service: "SOUNDCLOUD", name: DEST_NAME },
      mode: "ADD_ONLY",
      isEnabled: true,
      intervalMinutes: 0,
    });
    console.log(`[test] group ${group.id} (${group.members.length} members)`);
    for (const m of group.members) {
      console.log(`  - ${m.playlist.service}: ${m.playlist.name} (${m.playlist.servicePlaylistId})`);
    }
    rule = await prisma.syncRule.findFirst({
      where: { userId: user.id, sourcePlaylistId: source.servicePlaylistId },
      include: { destinations: true },
    });
  } else {
    console.log(`[test] reusing existing rule (${rule.destinations.length} destinations)`);
  }
  if (!rule) throw new Error("Sync rule not created");
  console.log(`[test] rule ${rule.id}`);

  console.log("[test] refreshing YouTube source playlist tracks...");
  const refreshed = await syncPlaylistTracksToDb(user.id, serviceKey(source.service), source.servicePlaylistId);
  console.log(`[test] refreshed: ${JSON.stringify(refreshed)}`);

  console.log("[test] starting sync run...");
  const job = await runSync(rule.id);
  console.log(`[test] job ${job.id} finished with status ${job.status}`);
  console.log(`[test] stats: ${job.statsJson}`);
  if (job.errorMessage) console.log(`[test] error: ${job.errorMessage}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
