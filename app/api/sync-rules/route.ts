import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { SyncRuleRequestError, validateSyncRuleInput } from "@/lib/services/syncRuleRequest";

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
  const body = await request.json().catch(() => ({}));
  const input = await validateSyncRuleInput(session.userId, body).catch((error) => {
    if (error instanceof SyncRuleRequestError) return error;
    throw error;
  });
  if (input instanceof SyncRuleRequestError) {
    return NextResponse.json({ error: input.message }, { status: input.status });
  }
  const rule = await prisma.syncRule.create({
    data: {
      userId: session.userId,
      name: input.name,
      sourceService: input.sourceService,
      sourcePlaylistId: input.sourcePlaylistId,
      mode: input.mode,
      direction: "ONE_WAY",
      intervalMinutes: input.intervalMinutes,
      isEnabled: input.isEnabled,
      nextRunAt: null,
      queuedReason: input.isEnabled ? "rule_created" : null,
      queuedAt: input.isEnabled ? new Date() : null,
      destinations: {
        create: input.destinations.map((destination) => ({
          service: destination.service,
          playlistId: destination.playlistId,
          isEnabled: true,
        })),
      },
    },
    include: { destinations: true },
  });
  return NextResponse.json({ rule });
}
