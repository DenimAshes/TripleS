ALTER TABLE "BrowserJob"
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "workerId" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "BrowserJob_status_updatedAt_idx" ON "BrowserJob"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "BrowserJob_workerId_idx" ON "BrowserJob"("workerId");
