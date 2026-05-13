CREATE TABLE "ServiceCooldown" (
    "service" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCooldown_pkey" PRIMARY KEY ("service")
);
