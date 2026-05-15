import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { connectPlaylistGroup } from "@/lib/services/playlistGroupActions";

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
  try {
    const session = await requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const group = await connectPlaylistGroup(session.userId, body);
    return NextResponse.json({ group });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not connect playlists." },
      { status: 500 },
    );
  }
}

