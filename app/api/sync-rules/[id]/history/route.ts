import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the last N SyncJob rows for a rule with stats parsed out of
// statsJson. Used by the dashboard SyncRuleCard to show a small inline
// run-history without forcing the user to wade through /history or
// look at raw rows.

type StatsShape = {
  synced?: number;
  alreadySynced?: number;
  notFound?: number;
  manualRequired?: number;
  removed?: number;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request);
  const { id } = await context.params;

  const rule = await prisma.syncRule.findFirst({ where: { id, userId: session.userId } });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const jobs = await prisma.syncJob.findMany({
    where: { syncRuleId: id },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      errorKind: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      statsJson: true,
    },
  });

  return NextResponse.json({
    ruleId: id,
    jobs: jobs.map((job) => {
      let stats: StatsShape = {};
      try {
        stats = JSON.parse(job.statsJson) as StatsShape;
      } catch {}
      return {
        id: job.id,
        status: job.status,
        errorKind: job.errorKind,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
        durationMs: job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
        synced: stats.synced ?? 0,
        alreadySynced: stats.alreadySynced ?? 0,
        notFound: stats.notFound ?? 0,
        manualRequired: stats.manualRequired ?? 0,
        removed: stats.removed ?? 0,
      };
    }),
  });
}
