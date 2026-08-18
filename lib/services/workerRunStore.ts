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

export type WorkerRunStatus = "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED";

/**
 * A tick where every selected rule failed is a failed run, not a partial one.
 * Both the dashboard warning and the worker exit code read this, so they stay
 * in agreement instead of a green run hiding a fleet of broken rules.
 */
export function workerRunStatusFor(summary: Pick<WorkerRunSummary, "ran" | "failed">): WorkerRunStatus {
  if (summary.failed > 0 && summary.ran === 0) return "FAILED";
  if (summary.failed > 0) return "PARTIAL_SUCCESS";
  return "SUCCESS";
}

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
  const status = workerRunStatusFor(summary);
  return prisma.workerRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      errorMessage:
        status === "FAILED"
          ? `Every selected rule failed (${summary.failed}/${summary.selected}); no rule completed.`
          : null,
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
