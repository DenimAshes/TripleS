import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

function nextRunAt(intervalMinutes: number, isEnabled: boolean) {
  return isEnabled && intervalMinutes > 0 ? new Date(Date.now() + intervalMinutes * 60_000) : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json();
  const existing = await prisma.syncRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const intervalMinutes = Number(body.intervalMinutes || 0);
  const isEnabled = Boolean(body.isEnabled);
  const rule = await prisma.$transaction(async (tx) => {
    await tx.syncDestination.deleteMany({ where: { syncRuleId: id } });
    return tx.syncRule.update({
      where: { id },
      data: {
        name: String(body.name || "Sync rule"),
        sourceService: String(body.sourceService),
        sourcePlaylistId: String(body.sourcePlaylistId),
        mode: String(body.mode || "ADD_ONLY"),
        intervalMinutes,
        isEnabled,
        nextRunAt: nextRunAt(intervalMinutes, isEnabled),
        destinations: {
          create: (body.destinations || []).map((destination: { service: string; playlistId: string }) => ({
            service: String(destination.service),
            playlistId: String(destination.playlistId),
            isEnabled: true,
          })),
        },
      },
      include: { destinations: true },
    });
  });
  return NextResponse.json({ rule });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const existing = await prisma.syncRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.syncRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
