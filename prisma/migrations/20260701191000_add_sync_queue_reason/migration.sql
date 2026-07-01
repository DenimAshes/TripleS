-- Add lightweight queue attribution for dashboard visibility.
ALTER TABLE "SyncRule" ADD COLUMN "queuedReason" TEXT;
ALTER TABLE "SyncRule" ADD COLUMN "queuedAt" TIMESTAMP(3);
