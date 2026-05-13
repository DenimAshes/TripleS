import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const playlists = await prisma.playlist.findMany({
    where: { userId: session.userId },
    orderBy: [{ service: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ playlists });
}
