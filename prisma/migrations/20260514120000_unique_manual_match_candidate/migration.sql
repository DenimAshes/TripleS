-- Deduplicate existing ManualMatchCandidate rows on the natural key before adding the constraint.
DELETE FROM "ManualMatchCandidate" a
USING "ManualMatchCandidate" b
WHERE a.ctid < b.ctid
  AND a."userId" = b."userId"
  AND a."sourceServiceTrackId" = b."sourceServiceTrackId"
  AND a."targetService" = b."targetService"
  AND a."candidateServiceTrackId" = b."candidateServiceTrackId";

CREATE UNIQUE INDEX "ManualMatchCandidate_natural_key"
  ON "ManualMatchCandidate" ("userId", "sourceServiceTrackId", "targetService", "candidateServiceTrackId");
