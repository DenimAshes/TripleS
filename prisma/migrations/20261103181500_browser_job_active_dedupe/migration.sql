WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "type", "inputJson"
      ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, "createdAt", id
    ) AS rn
  FROM "BrowserJob"
  WHERE status IN ('queued', 'running')
)
UPDATE "BrowserJob" job
SET status = 'cancelled',
    "currentStep" = 'Cancelled',
    "errorCode" = 'CANCELLED',
    "errorMessage" = 'Superseded duplicate active browser job during database deduplication.',
    "errorDetailsJson" = '{"recommendedAction":"Use the remaining active job."}',
    "childPidsJson" = NULL,
    "finishedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE job.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "BrowserJob_active_dedupe_uniq"
  ON "BrowserJob" ("userId", "type", "inputJson")
  WHERE status IN ('queued', 'running');
