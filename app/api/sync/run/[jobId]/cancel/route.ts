import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stops a SyncJob currently in RUNNING state. The engine checks SyncJob.status
// on its periodic checkpoint loop, so flipping the row to CANCELLED here
// makes the next checkpoint throw and unwind the run. Killing child PIDs
// (browser subprocesses) is done by the engine's finally block.
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await requireAuth(request);
  const { jobId } = await context.params;

  const job = await prisma.syncJob.findFirst({
    where: { id: jobId, syncRule: { userId: session.userId } },
    select: { id: true, status: true, syncRuleId: true },
  });
  if (!job) return NextResponse.json({ error: "Sync job not found" }, { status: 404 });

  if (job.status !== "RUNNING") {
    return NextResponse.json(
      { error: `Cannot cancel a ${job.status.toLowerCase()} job`, status: job.status },
      { status: 409 },
    );
  }

  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      errorMessage: "Cancelled by user",
      errorKind: "cancelled",
    },
  });

  return NextResponse.json({ ok: true, jobId, status: "CANCELLED" });
}
