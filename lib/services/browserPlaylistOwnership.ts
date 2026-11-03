import { prisma } from "@/lib/db/prisma";

export async function browserPlaylistOwnedByUser(userId: string, service: string, servicePlaylistId: string) {
  const playlist = await prisma.playlist.findFirst({
    where: {
      userId,
      service: service.toUpperCase(),
      servicePlaylistId,
    },
    select: { id: true },
  });
  return Boolean(playlist);
}
