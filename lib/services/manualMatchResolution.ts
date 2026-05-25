import { prisma } from "@/lib/db/prisma";

export async function closeCompetingManualCandidates({
  userId,
  sourceServiceTrackId,
  targetService,
  keepId,
}: {
  userId: string;
  sourceServiceTrackId: string;
  targetService: string;
  keepId: string;
}) {
  return prisma.manualMatchCandidate.updateMany({
    where: {
      userId,
      sourceServiceTrackId,
      targetService,
      id: { not: keepId },
      status: "PENDING",
    },
    data: { status: "REJECTED" },
  });
}

export async function scheduleManualMatchFollowupSync({
  userId,
  sourceServiceTrackId,
}: {
  userId: string;
  sourceServiceTrackId: string;
}) {
  return scheduleManualMatchFollowupSyncs({
    userId,
    sourceServiceTrackIds: [sourceServiceTrackId],
  });
}

export async function scheduleManualMatchFollowupSyncs({
  userId,
  sourceServiceTrackIds,
}: {
  userId: string;
  sourceServiceTrackIds: string[];
}) {
  const uniqueSourceTrackIds = Array.from(new Set(sourceServiceTrackIds.filter(Boolean)));
  if (!uniqueSourceTrackIds.length) return { count: 0 };

  const sourceStates = await prisma.playlistTrackState.findMany({
    where: {
      serviceTrackId: { in: uniqueSourceTrackIds },
      removedAt: null,
      playlist: { userId },
    },
    include: {
      playlist: {
        select: {
          service: true,
          servicePlaylistId: true,
        },
      },
    },
  });
  if (!sourceStates.length) return { count: 0 };

  const sources = Array.from(
    new Map(
      sourceStates.map((state) => [
        `${state.playlist.service}:${state.playlist.servicePlaylistId}`,
        {
          sourceService: state.playlist.service,
          sourcePlaylistId: state.playlist.servicePlaylistId,
        },
      ]),
    ).values(),
  );
  if (!sources.length) return { count: 0 };

  return prisma.syncRule.updateMany({
    where: {
      userId,
      direction: "TWO_WAY",
      isEnabled: true,
      OR: sources,
    },
    data: { nextRunAt: null },
  });
}
