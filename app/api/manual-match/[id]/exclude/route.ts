import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";
import { findCandidateGroup } from "@/lib/sync/manualMatchGroup";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;
  const existing = await prisma.manualMatchCandidate.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const group = await findCandidateGroup({
    userId: session.userId,
    sourceServiceTrackId: existing.sourceServiceTrackId,
    targetService: existing.targetService,
  });
  if (!group) {
    return NextResponse.json({ error: "Connected playlists not found." }, { status: 404 });
  }

  await prisma.syncTrackExclusion.upsert({
    where: {
      groupId_sourceTrackId_targetService: {
        groupId: group.id,
        sourceTrackId: existing.sourceServiceTrackId,
        targetService: existing.targetService,
      },
    },
    update: { reason: "USER_CHOICE" },
    create: {
      groupId: group.id,
      sourceTrackId: existing.sourceServiceTrackId,
      targetService: existing.targetService,
      reason: "USER_CHOICE",
    },
  });
  const match = await prisma.manualMatchCandidate.update({
    where: { id },
    data: { status: "REJECTED" },
  });

  return NextResponse.json({ match });
}
