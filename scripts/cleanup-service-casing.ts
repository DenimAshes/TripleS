import { prisma } from "@/lib/db/prisma";

async function normalizePlaylist(row: { id: string; service: string; servicePlaylistId: string }) {
  const service = row.service.toUpperCase();
  const canonical = await prisma.playlist.findUnique({
    where: { service_servicePlaylistId: { service, servicePlaylistId: row.servicePlaylistId } },
    select: { id: true },
  });

  if (!canonical) {
    await prisma.playlist.update({ where: { id: row.id }, data: { service } });
    return { updated: 1, merged: 0 };
  }

  await prisma.playlistGroupMember.updateMany({ where: { playlistId: row.id }, data: { playlistId: canonical.id, service } });
  const states = await prisma.playlistTrackState.findMany({
    where: { playlistId: row.id },
    select: { id: true, serviceTrackId: true },
  });
  for (const state of states) {
    const existing = await prisma.playlistTrackState.findFirst({
      where: { playlistId: canonical.id, serviceTrackId: state.serviceTrackId },
      select: { id: true },
    });
    if (existing) {
      await prisma.playlistTrackState.delete({ where: { id: state.id } });
    } else {
      await prisma.playlistTrackState.update({ where: { id: state.id }, data: { playlistId: canonical.id } });
    }
  }
  await prisma.playlist.delete({ where: { id: row.id } });
  return { updated: 0, merged: 1 };
}

async function main() {
  const playlists = await prisma.playlist.findMany({
    where: { service: { in: ["spotify", "youtube", "soundcloud"] } },
    select: { id: true, service: true, servicePlaylistId: true },
  });
  const members = await prisma.playlistGroupMember.findMany({
    where: { service: { in: ["spotify", "youtube", "soundcloud"] } },
    select: { id: true, service: true },
  });
  const destinations = await prisma.syncDestination.findMany({
    where: { service: { in: ["spotify", "youtube", "soundcloud"] } },
    select: { id: true, service: true },
  });

  let playlistUpdated = 0;
  let playlistMerged = 0;
  for (const row of playlists) {
    const result = await normalizePlaylist(row);
    playlistUpdated += result.updated;
    playlistMerged += result.merged;
  }
  for (const row of members) {
    await prisma.playlistGroupMember.update({ where: { id: row.id }, data: { service: row.service.toUpperCase() } });
  }
  for (const row of destinations) {
    await prisma.syncDestination.update({ where: { id: row.id }, data: { service: row.service.toUpperCase() } });
  }

  console.log(JSON.stringify({ playlistUpdated, playlistMerged, members: members.length, destinations: destinations.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
