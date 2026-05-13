import { prisma } from "@/lib/db/prisma";

export async function findCandidateGroup({
  userId,
  sourceServiceTrackId,
  targetService,
}: {
  userId: string;
  sourceServiceTrackId: string;
  targetService: string;
}) {
  const state = await prisma.playlistTrackState.findFirst({
    where: {
      serviceTrackId: sourceServiceTrackId,
      removedAt: null,
      playlist: {
        userId,
        groupMembers: {
          some: {
            group: {
              members: { some: { service: targetService } },
            },
          },
        },
      },
    },
    include: {
      playlist: {
        include: {
          groupMembers: {
            include: {
              group: true,
            },
          },
        },
      },
    },
  });

  return state?.playlist.groupMembers.find((member) => member.group.userId === userId)?.group || null;
}
