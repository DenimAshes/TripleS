CREATE TABLE "WorkerSessionState" (
    "service" TEXT NOT NULL,
    "stateGzipBase64" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "WorkerSessionState_pkey" PRIMARY KEY ("service")
);
