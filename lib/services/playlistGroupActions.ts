import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum, serviceKey } from "@/lib/services/adapterFactory";

export class PlaylistGroupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PlaylistGroupError";
  }
}

export type ConnectPlaylistsInput = {
  sourcePlaylistId: string;
  destinationPlaylistIds?: string[];
  createDestination?: {
    service: string;
    name: string;
  } | null;
  name?: string;
  mode?: string;
  intervalMinutes?: number;
  isEnabled?: boolean;
};

export async function connectPlaylistGroup(userId: string, input: ConnectPlaylistsInput) {
  const sourcePlaylistId = String(input.sourcePlaylistId || "");
  const destinationPlaylistIds = Array.isArray(input.destinationPlaylistIds)
    ? input.destinationPlaylistIds.map(String).filter(Boolean)
    : [];
  const createDestination =
    input.createDestination && typeof input.createDestination === "object"
      ? {
          service: String(input.createDestination.service || ""),
          name: String(input.createDestination.name || "").trim(),
        }
      : null;
  const intervalMinutes = Number(input.intervalMinutes || 0);

  if (!sourcePlaylistId || (destinationPlaylistIds.length === 0 && !createDestination)) {
    throw new PlaylistGroupError(400, "Choose playlists to connect.");
  }
  if (createDestination && (!createDestination.service || !createDestination.name)) {
    throw new PlaylistGroupError(400, "Name the new playlist.");
  }

  const source = await prisma.playlist.findUnique({ where: { id: sourcePlaylistId } });
  if (!source || source.userId !== userId) {
    throw new PlaylistGroupError(404, "Main playlist not found.");
  }

  // Track playlists we create on the remote service so we can roll them back
  // if anything fails before the group/rule is fully committed. Without this,
  // a transient DB error after createPlaylist would leave an empty playlist
  // orphaned on SoundCloud.
  const rollbackCreated: Array<{ service: string; servicePlaylistId: string; dbId: string }> = [];

  if (createDestination) {
    const service = serviceEnum(serviceKey(createDestination.service));
    if (service === source.service) {
      throw new PlaylistGroupError(409, "Choose another platform for the new playlist.");
    }
    if (service === "YOUTUBE") {
      throw new PlaylistGroupError(409, "Create the YouTube Music playlist there first, then choose it here.");
    }
    const adapter = getAdapter(service, userId);
    const created = await adapter.createPlaylist(createDestination.name);
    const playlist = await prisma.playlist.upsert({
      where: { service_servicePlaylistId: { service, servicePlaylistId: created.id } },
      update: {
        userId,
        name: created.name,
        description: created.description,
        imageUrl: created.imageUrl,
        trackCount: created.trackCount,
        isWritable: created.isWritable,
        apiId: created.apiId ?? null,
        permalink: created.permalink ?? null,
        createdBySystem: true,
        lastFetchedAt: new Date(),
      },
      create: {
        userId,
        service,
        servicePlaylistId: created.id,
        apiId: created.apiId ?? null,
        permalink: created.permalink ?? null,
        name: created.name,
        description: created.description,
        imageUrl: created.imageUrl,
        trackCount: created.trackCount,
        isWritable: created.isWritable,
        createdBySystem: true,
        lastFetchedAt: new Date(),
      },
    });
    destinationPlaylistIds.push(playlist.id);
    rollbackCreated.push({ service, servicePlaylistId: created.id, dbId: playlist.id });
  }

  const rollback = async (cause: unknown) => {
    for (const item of rollbackCreated) {
      try {
        const adapter = getAdapter(item.service, userId);
        if (typeof adapter.deletePlaylist === "function") {
          await adapter.deletePlaylist(item.servicePlaylistId);
        }
      } catch (deleteError) {
        console.warn(
          `[playlistGroupActions] failed to roll back ${item.service}:${item.servicePlaylistId} after error (${cause instanceof Error ? cause.message : String(cause)}): ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
        );
      }
      await prisma.playlist.delete({ where: { id: item.dbId } }).catch(() => undefined);
    }
  };

  try {

  const playlistIds = [sourcePlaylistId, ...destinationPlaylistIds];
  const playlists = await prisma.playlist.findMany({
    where: { id: { in: playlistIds }, userId },
  });
  if (playlists.length !== playlistIds.length) {
    throw new PlaylistGroupError(404, "Playlist not found.");
  }

  const destinations = playlists.filter((playlist) => destinationPlaylistIds.includes(playlist.id));
  const notWritable = destinations.find((playlist) => !playlist.isWritable);
  if (notWritable) {
    throw new PlaylistGroupError(409, `${notWritable.name} cannot be changed from this app.`);
  }

  const services = new Set(playlists.map((playlist) => playlist.service));
  if (services.size !== playlists.length) {
    throw new PlaylistGroupError(400, "Choose only one playlist from each platform.");
  }

  const existingMembers = await prisma.playlistGroupMember.findMany({
    where: { playlistId: { in: playlistIds } },
    include: { playlist: true, group: true },
  });
  const sourceGroup = existingMembers.find((member) => member.playlistId === sourcePlaylistId)?.group;
  const blocked = existingMembers.find((member) => member.groupId !== sourceGroup?.id);
  if (blocked) {
    throw new PlaylistGroupError(409, `${blocked.playlist.name} is already connected to another group.`);
  }
  if (sourceGroup) {
    const groupMembers = await prisma.playlistGroupMember.findMany({ where: { groupId: sourceGroup.id } });
    const usedServices = new Set(groupMembers.map((member) => member.service));
    for (const destination of destinations) {
      const alreadyThisPlaylist = groupMembers.some((member) => member.playlistId === destination.id);
      if (!alreadyThisPlaylist && usedServices.has(destination.service)) {
        throw new PlaylistGroupError(409, `This connection already has a ${destination.service} playlist.`);
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const groupRow = sourceGroup
      ? await tx.playlistGroup.update({
          where: { id: sourceGroup.id },
          data: { name: sourceGroup.name },
        })
      : await tx.playlistGroup.create({
          data: {
            userId,
            name: input.name ? String(input.name) : source.name,
          },
        });

    for (const playlist of playlists) {
      await tx.playlistGroupMember.upsert({
        where: { playlistId: playlist.id },
        update: { groupId: groupRow.id, service: playlist.service },
        create: { groupId: groupRow.id, playlistId: playlist.id, service: playlist.service },
      });
    }

    const allGroupMembers = await tx.playlistGroupMember.findMany({
      where: { groupId: groupRow.id },
      include: { playlist: true },
    });
    const ruleDestinations = allGroupMembers
      .map((member) => member.playlist)
      .filter((playlist) => playlist.id !== source.id && playlist.isWritable);

    const ruleName = input.name ? String(input.name) : `${source.name} sync`;
    const existingRule = await tx.syncRule.findFirst({
      where: { userId, sourcePlaylistId: source.servicePlaylistId },
      include: { destinations: true },
    });

    if (existingRule) {
      await tx.syncDestination.deleteMany({ where: { syncRuleId: existingRule.id } });
      await tx.syncRule.update({
        where: { id: existingRule.id },
        data: {
          name: ruleName,
          sourceService: source.service,
          mode: String(input.mode || existingRule.mode || "ADD_ONLY"),
          intervalMinutes,
          isEnabled: Boolean(input.isEnabled ?? true),
          nextRunAt: Boolean(input.isEnabled ?? true) ? null : existingRule.nextRunAt,
          destinations: {
            create: ruleDestinations.map((playlist) => ({
              service: playlist.service,
              playlistId: playlist.servicePlaylistId,
              isEnabled: true,
            })),
          },
        },
      });
    } else {
      await tx.syncRule.create({
        data: {
          userId,
          name: ruleName,
          sourceService: source.service,
          sourcePlaylistId: source.servicePlaylistId,
          mode: String(input.mode || "ADD_ONLY"),
          direction: "ONE_WAY",
          intervalMinutes,
          isEnabled: Boolean(input.isEnabled ?? true),
          nextRunAt: null,
          destinations: {
            create: ruleDestinations.map((playlist) => ({
              service: playlist.service,
              playlistId: playlist.servicePlaylistId,
              isEnabled: true,
            })),
          },
        },
      });
    }

    return tx.playlistGroup.findUniqueOrThrow({
      where: { id: groupRow.id },
      include: { members: { include: { playlist: true } } },
    });
  });
  } catch (error) {
    await rollback(error);
    throw error;
  }
}

