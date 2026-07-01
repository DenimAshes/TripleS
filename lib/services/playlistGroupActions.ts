import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum, serviceKey } from "@/lib/services/adapterFactory";
import type { Prisma } from "@prisma/client";

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
  runInitialSync?: boolean;
};

const SERVICES = new Set(["SPOTIFY", "YOUTUBE", "SOUNDCLOUD"]);
const MODES = new Set(["ADD_ONLY", "ADD_AND_REMOVE", "FULL_MIRROR"]);

type GroupRulePlaylist = {
  id: string;
  service: string;
  servicePlaylistId: string;
  name: string;
  isWritable: boolean;
};

export type NormalizedConnectPlaylistsInput = {
  sourcePlaylistId: string;
  destinationPlaylistIds: string[];
  createDestination: { service: string; name: string } | null;
  name?: string;
  mode: string;
  intervalMinutes: number;
  isEnabled: boolean;
};

function normalizeService(value: unknown) {
  const service = String(value || "").trim().toUpperCase();
  if (!SERVICES.has(service)) {
    throw new PlaylistGroupError(400, "Choose a valid platform.");
  }
  return service;
}

function normalizeMode(value: unknown) {
  const mode = String(value || "ADD_ONLY").trim().toUpperCase();
  if (!MODES.has(mode)) {
    throw new PlaylistGroupError(400, "Choose a valid sync mode.");
  }
  return mode;
}

function normalizeInterval(value: unknown) {
  const interval = Number(value ?? 5);
  if (!Number.isInteger(interval) || interval < 1 || interval > 24 * 60) {
    throw new PlaylistGroupError(400, "Sync interval must be between 1 and 1440 minutes.");
  }
  return interval;
}

function normalizeName(value: unknown, fallback?: string) {
  const name = String(value || "").trim();
  const normalized = name || fallback;
  return normalized ? normalized.slice(0, 120) : undefined;
}

export function normalizeConnectPlaylistsInput(input: unknown): NormalizedConnectPlaylistsInput {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const sourcePlaylistId = String(raw.sourcePlaylistId || "").trim();
  const destinationPlaylistIds = Array.isArray(raw.destinationPlaylistIds)
    ? Array.from(new Set(raw.destinationPlaylistIds.map((value) => String(value || "").trim()).filter(Boolean)))
    : [];
  const createDestinationRaw =
    raw.createDestination && typeof raw.createDestination === "object"
      ? (raw.createDestination as Record<string, unknown>)
      : null;
  const createDestination = createDestinationRaw
    ? {
        service: normalizeService(createDestinationRaw.service),
        name: normalizeName(createDestinationRaw.name) || "",
      }
    : null;

  if (!sourcePlaylistId || (destinationPlaylistIds.length === 0 && !createDestination)) {
    throw new PlaylistGroupError(400, "Choose playlists to connect.");
  }
  if (destinationPlaylistIds.includes(sourcePlaylistId)) {
    throw new PlaylistGroupError(400, "Source playlist cannot also be a destination.");
  }
  if (destinationPlaylistIds.length > 2) {
    throw new PlaylistGroupError(400, "Choose no more than one playlist per other platform.");
  }
  if (createDestination && !createDestination.name) {
    throw new PlaylistGroupError(400, "Name the new playlist.");
  }

  return {
    sourcePlaylistId,
    destinationPlaylistIds,
    createDestination,
    name: normalizeName(raw.name),
    mode: normalizeMode(raw.mode),
    intervalMinutes: normalizeInterval(raw.intervalMinutes),
    isEnabled: Boolean(raw.isEnabled ?? true),
  };
}

function groupRuleName(groupName: string, source: GroupRulePlaylist) {
  return `${groupName} - ${source.name}`;
}

async function upsertGroupSyncRules(
  tx: Prisma.TransactionClient,
  {
    userId,
    groupName,
    playlists,
    mode,
    intervalMinutes,
    isEnabled,
  }: {
    userId: string;
    groupName: string;
    playlists: GroupRulePlaylist[];
    mode: string;
    intervalMinutes: number;
    isEnabled: boolean;
  },
) {
  for (const source of playlists) {
    const destinations = playlists.filter((playlist) => playlist.id !== source.id && playlist.isWritable);
    if (destinations.length === 0) continue;

    const existingRule = await tx.syncRule.findFirst({
      where: {
        userId,
        sourceService: source.service,
        sourcePlaylistId: source.servicePlaylistId,
      },
      include: { destinations: true },
    });
    const data = {
      name: groupRuleName(groupName, source),
      sourceService: source.service,
      sourcePlaylistId: source.servicePlaylistId,
      mode,
      direction: "TWO_WAY",
      intervalMinutes,
      isEnabled,
      nextRunAt: isEnabled ? null : existingRule?.nextRunAt ?? null,
      queuedReason: isEnabled ? "playlist_group_connected" : existingRule?.queuedReason ?? null,
      queuedAt: isEnabled ? new Date() : existingRule?.queuedAt ?? null,
      destinations: {
        create: destinations.map((playlist) => ({
          service: playlist.service,
          playlistId: playlist.servicePlaylistId,
          isEnabled: true,
        })),
      },
    };

    if (existingRule) {
      await tx.syncDestination.deleteMany({ where: { syncRuleId: existingRule.id } });
      await tx.syncRule.update({
        where: { id: existingRule.id },
        data,
      });
    } else {
      await tx.syncRule.create({
        data: {
          userId,
          ...data,
        },
      });
    }
  }
}

export async function connectPlaylistGroup(userId: string, input: ConnectPlaylistsInput) {
  const normalized = normalizeConnectPlaylistsInput(input);
  const destinationPlaylistIds = [...normalized.destinationPlaylistIds];
  const { sourcePlaylistId, createDestination, intervalMinutes } = normalized;

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
    // Two-phase rollback per created destination:
    //   1) best-effort delete on the remote service (SC playlist)
    //   2) atomic DB cleanup that also removes any rows that would
    //      otherwise FK-block the Playlist delete (group members,
    //      track states). The DB step is wrapped in a transaction so
    //      we never end up with a half-cleaned destination — either
    //      the Playlist row and its dependents all go, or nothing does.
    // If (1) fails the DB row is still removed and the orphan-cleanup
    // script will pick the remote playlist up later (createdBySystem
    // is still set on the row until this point).
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    for (const item of rollbackCreated) {
      try {
        const adapter = getAdapter(item.service, userId);
        if (typeof adapter.deletePlaylist === "function") {
          await adapter.deletePlaylist(item.servicePlaylistId);
        }
      } catch (deleteError) {
        console.warn(
          `[playlistGroupActions] remote rollback failed for ${item.service}:${item.servicePlaylistId} (cause: ${causeMessage}): ${deleteError instanceof Error ? deleteError.message : String(deleteError)}. DB row will still be removed; run "npm run cleanup:orphans" to sweep the leftover.`,
        );
      }
      try {
        await prisma.$transaction([
          prisma.playlistGroupMember.deleteMany({ where: { playlistId: item.dbId } }),
          prisma.playlistTrackState.deleteMany({ where: { playlistId: item.dbId } }),
          prisma.playlist.delete({ where: { id: item.dbId } }),
        ]);
      } catch (dbError) {
        console.warn(
          `[playlistGroupActions] DB rollback failed for playlist ${item.dbId} (cause: ${causeMessage}): ${dbError instanceof Error ? dbError.message : String(dbError)}. Manual cleanup may be required.`,
        );
      }
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
    const requestedGroupName = normalized.name || sourceGroup?.name || source.name;
    const groupRow = sourceGroup
      ? await tx.playlistGroup.update({
          where: { id: sourceGroup.id },
          data: { name: requestedGroupName },
        })
      : await tx.playlistGroup.create({
          data: {
            userId,
            name: requestedGroupName,
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
    await upsertGroupSyncRules(tx, {
      userId,
      groupName: groupRow.name,
      playlists: allGroupMembers.map((member) => member.playlist),
      mode: normalized.mode,
      intervalMinutes,
      isEnabled: normalized.isEnabled,
    });

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

