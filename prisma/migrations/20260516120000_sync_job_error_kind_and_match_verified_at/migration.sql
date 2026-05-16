ALTER TABLE "SyncJob" ADD COLUMN "errorKind" TEXT;
CREATE INDEX IF NOT EXISTS "SyncJob_status_errorKind_idx" ON "SyncJob"("status", "errorKind");

ALTER TABLE "TrackMatch" ADD COLUMN "verifiedAt" TIMESTAMP(3);
