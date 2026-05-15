-- ServiceTrack fingerprint columns
ALTER TABLE "ServiceTrack"
  ADD COLUMN "titleNormalized" TEXT,
  ADD COLUMN "artistNormalized" TEXT,
  ADD COLUMN "durationBucket" INTEGER;

CREATE INDEX "ServiceTrack_service_titleNormalized_artistNormalized_idx"
  ON "ServiceTrack" ("service", "titleNormalized", "artistNormalized");

CREATE INDEX "ServiceTrack_service_isrc_idx"
  ON "ServiceTrack" ("service", "isrc");

-- Persistent cross-process search cache
CREATE TABLE "SearchCache" (
  "id" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "queryNorm" TEXT NOT NULL,
  "resultsJson" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchCache_service_queryNorm_key"
  ON "SearchCache" ("service", "queryNorm");

CREATE INDEX "SearchCache_fetchedAt_idx" ON "SearchCache" ("fetchedAt");

-- Negative match cache: don't re-search hopeless tracks for a while
CREATE TABLE "TrackMatchNegativeCache" (
  "id" TEXT NOT NULL,
  "internalTrackId" TEXT NOT NULL,
  "targetService" TEXT NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackMatchNegativeCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackMatchNegativeCache_internalTrackId_targetService_key"
  ON "TrackMatchNegativeCache" ("internalTrackId", "targetService");
