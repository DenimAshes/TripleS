import { prisma } from "@/lib/db/prisma";

export type WorkerSkipReason = {
  ruleId?: string;
  name?: string;
  reason: string;
  detail?: string;
};

export type WorkerRunSummary = {
  due: number;
  runnable: number;
  selected: number;
  ran: number;
  failed: number;
  skipped: number;
  skippedReasons?: WorkerSkipReason[];
};

function serializeSkippedReasons(reasons: WorkerSkipReason[] | undefined): string | null {
  if (!reasons?.length) return null;
  return JSON.stringify(reasons.slice(0, 12));
}

export async function startWorkerRun(worker: string) {
  return prisma.workerRun.create({
    data: {
      worker,
      status: "RUNNING",
    },
    select: { id: true },
  });
}

export async function finishWorkerRun(id: string, summary: WorkerRunSummary) {
  return prisma.workerRun.update({
    where: { id },
    data: {
      status: summary.failed > 0 ? "PARTIAL_SUCCESS" : "SUCCESS",
      finishedAt: new Date(),
      due: summary.due,
      runnable: summary.runnable,
      selected: summary.selected,
      ran: summary.ran,
      failed: summary.failed,
      skipped: summary.skipped,
      skippedJson: serializeSkippedReasons(summary.skippedReasons),
    },
  });
}

export async function failWorkerRun(id: string, error: unknown, partial?: Partial<WorkerRunSummary>) {
  return prisma.workerRun.update({
    where: { id },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      due: partial?.due ?? 0,
      runnable: partial?.runnable ?? 0,
      selected: partial?.selected ?? 0,
      ran: partial?.ran ?? 0,
      failed: partial?.failed ?? 0,
      skipped: partial?.skipped ?? 0,
      skippedJson: serializeSkippedReasons(partial?.skippedReasons),
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  });
}
