import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { SyncRuleRequestError, validateSyncRuleInput } from "@/lib/services/syncRuleRequest";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const existing = await prisma.syncRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const input = await validateSyncRuleInput(session.userId, body).catch((error) => {
    if (error instanceof SyncRuleRequestError) return error;
    throw error;
  });
  if (input instanceof SyncRuleRequestError) {
    return NextResponse.json({ error: input.message }, { status: input.status });
  }
  const rule = await prisma.$transaction(async (tx) => {
    await tx.syncDestination.deleteMany({ where: { syncRuleId: id } });
    return tx.syncRule.update({
      where: { id },
      data: {
        name: input.name,
        sourceService: input.sourceService,
        sourcePlaylistId: input.sourcePlaylistId,
        mode: input.mode,
        intervalMinutes: input.intervalMinutes,
        isEnabled: input.isEnabled,
        nextRunAt: input.isEnabled ? null : existing.nextRunAt,
        queuedReason: input.isEnabled ? "rule_updated" : existing.queuedReason,
        queuedAt: input.isEnabled ? new Date() : existing.queuedAt,
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
