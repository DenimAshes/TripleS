CREATE TABLE "WorkerRun" (
  "id" TEXT NOT NULL,
  "worker" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "due" INTEGER NOT NULL DEFAULT 0,
  "runnable" INTEGER NOT NULL DEFAULT 0,
  "selected" INTEGER NOT NULL DEFAULT 0,
  "ran" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "skippedJson" TEXT,
  "errorMessage" TEXT,

  CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerRun_worker_startedAt_idx" ON "WorkerRun"("worker", "startedAt");
CREATE INDEX "WorkerRun_status_startedAt_idx" ON "WorkerRun"("status", "startedAt");
