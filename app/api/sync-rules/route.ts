import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await requireAuth(request);
  const rules = await prisma.syncRule.findMany({
    where: { userId: session.userId },
    include: { destinations: true },
  });
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  const body = await request.json();
  const intervalMinutes = Number(body.intervalMinutes || 0);
  const rule = await prisma.syncRule.create({
    data: {
      userId: session.userId,
      name: String(body.name || "New sync rule"),
      sourceService: String(body.sourceService),
      sourcePlaylistId: String(body.sourcePlaylistId),
      mode: String(body.mode || "ADD_ONLY"),
      direction: "ONE_WAY",
      intervalMinutes,
      isEnabled: Boolean(body.isEnabled ?? true),
      nextRunAt: null,
      destinations: {
        create: (body.destinations || []).map((destination: { service: string; playlistId: string }) => ({
          service: String(destination.service),
          playlistId: destination.playlistId,
          isEnabled: true,
        })),
      },
    },
    include: { destinations: true },
  });
  return NextResponse.json({ rule });
}
