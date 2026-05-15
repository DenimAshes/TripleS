CREATE TABLE IF NOT EXISTS "BrowserJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorDetailsJson" TEXT,
    "currentStep" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BrowserJob_userId_status_idx" ON "BrowserJob" ("userId", "status");
CREATE INDEX IF NOT EXISTS "BrowserJob_type_status_idx" ON "BrowserJob" ("type", "status");
CREATE INDEX IF NOT EXISTS "BrowserJob_createdAt_idx" ON "BrowserJob" ("createdAt");
