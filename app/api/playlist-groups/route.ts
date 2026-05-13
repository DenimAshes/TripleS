import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { getAdapter, serviceEnum, serviceKey } from "@/lib/services/adapterFactory";

function nextRunAt(intervalMinutes: number) {
  return intervalMinutes > 0 ? new Date(Date.now() + intervalMinutes * 60_000) : null;
}

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const groups = await prisma.playlistGroup.findMany({
    where: { userId: session.userId },
    include: { members: { include: { playlist: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const sourcePlaylistId = String(body.sourcePlaylistId || "");
  const destinationPlaylistIds = Array.isArray(body.destinationPlaylistIds)
    ? body.destinationPlaylistIds.map(String).filter(Boolean)
    : [];
  const createDestination =
    body.createDestination && typeof body.createDestination === "object"
      ? {
          service: String(body.createDestination.service || ""),
          name: String(body.createDestination.name || "").trim(),
        }
      : null;
  const intervalMinutes = Number(body.intervalMinutes || 0);

  if (!sourcePlaylistId || (destinationPlaylistIds.length === 0 && !createDestination)) {
    return NextResponse.json({ error: "Choose playlists to connect." }, { status: 400 });
  }
  if (createDestination && (!createDestination.service || !createDestination.name)) {
    return NextResponse.json({ error: "Name the new playlist." }, { status: 400 });
  }

  const source = await prisma.playlist.findUnique({ where: { id: sourcePlaylistId } });
  if (!source || source.userId !== session.userId) {
    return NextResponse.json({ error: "Main playlist not found." }, { status: 404 });
  }

  if (createDestination) {
    const service = serviceEnum(serviceKey(createDestination.service));
    if (service === source.service) {
      return NextResponse.json({ error: "Choose another platform for the new playlist." }, { status: 409 });
    }
    if (service === "YOUTUBE") {
      return NextResponse.json({ error: "Create the YouTube Music playlist there first, then choose it here." }, { status: 409 });
    }
    const adapter = getAdapter(service, session.userId);
    const created = await adapter.createPlaylist(createDestination.name);
    const playlist = await prisma.playlist.upsert({
      where: { service_servicePlaylistId: { service, servicePlaylistId: created.id } },
      update: {
        userId: session.userId,
        name: created.name,
        description: created.description,
        imageUrl: created.imageUrl,
        trackCount: created.trackCount,
        isWritable: created.isWritable,
        lastFetchedAt: new Date(),
      },
      create: {
        userId: session.userId,
        service,
        servicePlaylistId: created.id,
        name: created.name,
        description: created.description,
        imageUrl: created.imageUrl,
        trackCount: created.trackCount,
        isWritable: created.isWritable,
        lastFetchedAt: new Date(),
      },
    });
    destinationPlaylistIds.push(playlist.id);
  }

  const playlistIds = [sourcePlaylistId, ...destinationPlaylistIds];
  const playlists = await prisma.playlist.findMany({
    where: { id: { in: playlistIds }, userId: session.userId },
  });
  if (playlists.length !== playlistIds.length) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  const destinations = playlists.filter((playlist) => destinationPlaylistIds.includes(playlist.id));
  const notWritable = destinations.find((playlist) => !playlist.isWritable);
  if (notWritable) {
    return NextResponse.json({ error: `${notWritable.name} cannot be changed from this app.` }, { status: 409 });
  }

  const services = new Set(playlists.map((playlist) => playlist.service));
  if (services.size !== playlists.length) {
    return NextResponse.json({ error: "Choose only one playlist from each platform." }, { status: 409 });
  }

  const existingMembers = await prisma.playlistGroupMember.findMany({
    where: { playlistId: { in: playlistIds } },
    include: { playlist: true, group: true },
  });
  const sourceGroup = existingMembers.find((member) => member.playlistId === sourcePlaylistId)?.group;
  const blocked = existingMembers.find((member) => member.groupId !== sourceGroup?.id);
  if (blocked) {
    return NextResponse.json({ error: `${blocked.playlist.name} is already connected to another group.` }, { status: 409 });
  }
  if (sourceGroup) {
    const groupMembers = await prisma.playlistGroupMember.findMany({ where: { groupId: sourceGroup.id } });
    const usedServices = new Set(groupMembers.map((member) => member.service));
    for (const destination of destinations) {
      const alreadyThisPlaylist = groupMembers.some((member) => member.playlistId === destination.id);
      if (!alreadyThisPlaylist && usedServices.has(destination.service)) {
        return NextResponse.json({ error: `This connection already has a ${destination.service} playlist.` }, { status: 409 });
      }
    }
  }

  const group = await prisma.$transaction(async (tx) => {
    const groupRow = sourceGroup
      ? await tx.playlistGroup.update({
          where: { id: sourceGroup.id },
          data: { name: sourceGroup.name },
        })
      : await tx.playlistGroup.create({
          data: {
            userId: session.userId,
            name: body.name ? String(body.name) : source.name,
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

    const ruleName = body.name ? String(body.name) : `${source.name} sync`;
    const existingRule = await tx.syncRule.findFirst({
      where: { userId: session.userId, sourcePlaylistId: source.servicePlaylistId },
      include: { destinations: true },
    });

    if (existingRule) {
      await tx.syncDestination.deleteMany({ where: { syncRuleId: existingRule.id } });
      await tx.syncRule.update({
        where: { id: existingRule.id },
        data: {
          name: ruleName,
          sourceService: source.service,
          mode: String(body.mode || existingRule.mode || "ADD_ONLY"),
          intervalMinutes,
          isEnabled: Boolean(body.isEnabled ?? true),
          nextRunAt: nextRunAt(intervalMinutes),
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
          userId: session.userId,
          name: ruleName,
          sourceService: source.service,
          sourcePlaylistId: source.servicePlaylistId,
          mode: String(body.mode || "ADD_ONLY"),
          direction: "ONE_WAY",
          intervalMinutes,
          isEnabled: Boolean(body.isEnabled ?? true),
          nextRunAt: nextRunAt(intervalMinutes),
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

  return NextResponse.json({ group });
}
