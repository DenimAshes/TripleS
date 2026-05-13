import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await requireAuth(request);
  const { groupId } = await params;
  const body = await request.json().catch(() => ({}));
  const playlistId = String(body.playlistId || "");
  const serviceTrackId = String(body.serviceTrackId || "");
  const excluded = Boolean(body.excluded);

  if (!playlistId || !serviceTrackId) {
    return NextResponse.json({ error: "Song not found." }, { status: 400 });
  }

  const member = await prisma.playlistGroupMember.findFirst({
    where: {
      groupId,
      playlistId,
      group: { userId: session.userId },
    },
    include: { playlist: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Connected playlist not found." }, { status: 404 });
  }

  const state = await prisma.playlistTrackState.findFirst({
    where: {
      playlistId,
      serviceTrackId,
      removedAt: null,
    },
  });
  if (!state) {
    return NextResponse.json({ error: "Song not found in this playlist." }, { status: 404 });
  }

  if (!excluded) {
    await prisma.excludedTrack.deleteMany({
      where: { groupId, playlistId, serviceTrackId },
    });
    return NextResponse.json({ excluded: false });
  }

  await prisma.excludedTrack.upsert({
    where: {
      groupId_playlistId_serviceTrackId: { groupId, playlistId, serviceTrackId },
    },
    update: {},
    create: {
      groupId,
      playlistId,
      serviceTrackId,
      reason: "ONLY_HERE",
    },
  });
  return NextResponse.json({ excluded: true });
}
