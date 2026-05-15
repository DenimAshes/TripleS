-- Unify InternalTrack rows that share the same ISRC.
-- Before: each ServiceTrack created its own InternalTrack (id = "${sourceService}_${sourceTrackId}").
-- After:  one InternalTrack per real song (per ISRC); ServiceTrack and TrackMatch rows are repointed.

-- 1. Repoint ServiceTrack.internalTrackId to canonical InternalTrack (MIN(id) per ISRC).
WITH canonical AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY isrc) AS canonical_id
  FROM "InternalTrack"
  WHERE isrc IS NOT NULL
)
UPDATE "ServiceTrack" st
SET "internalTrackId" = c.canonical_id
FROM canonical c
WHERE st."internalTrackId" = c.id
  AND c.id <> c.canonical_id;

-- 2. Repoint TrackMatch.internalTrackId to canonical InternalTrack.
WITH canonical AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY isrc) AS canonical_id
  FROM "InternalTrack"
  WHERE isrc IS NOT NULL
)
UPDATE "TrackMatch" tm
SET "internalTrackId" = c.canonical_id
FROM canonical c
WHERE tm."internalTrackId" = c.id
  AND c.id <> c.canonical_id;

-- 3. Repoint TrackMatchNegativeCache.internalTrackId to canonical InternalTrack.
WITH canonical AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY isrc) AS canonical_id
  FROM "InternalTrack"
  WHERE isrc IS NOT NULL
)
UPDATE "TrackMatchNegativeCache" nc
SET "internalTrackId" = c.canonical_id
FROM canonical c
WHERE nc."internalTrackId" = c.id
  AND c.id <> c.canonical_id
  AND NOT EXISTS (
    SELECT 1 FROM "TrackMatchNegativeCache" existing
    WHERE existing."internalTrackId" = c.canonical_id
      AND existing."targetService" = nc."targetService"
  );

-- After redirect, some neg-cache rows may now collide on (canonical_id, targetService).
-- Delete the redundant duplicates (keep the most recent attemptedAt).
DELETE FROM "TrackMatchNegativeCache" a
USING "TrackMatchNegativeCache" b
WHERE a."internalTrackId" = b."internalTrackId"
  AND a."targetService" = b."targetService"
  AND a."attemptedAt" < b."attemptedAt";
DELETE FROM "TrackMatchNegativeCache" a
USING "TrackMatchNegativeCache" b
WHERE a."internalTrackId" = b."internalTrackId"
  AND a."targetService" = b."targetService"
  AND a."attemptedAt" = b."attemptedAt"
  AND a.id < b.id;

-- 4. Merge duplicate TrackMatch rows that now share the same internalTrackId.
-- Pick the row with lowest id as the canonical sink. Combine non-null service ids, take max confidence,
-- promote status to CONFIRMED > AUTO_MATCHED > anything else.
WITH grouped AS (
  SELECT "internalTrackId",
         MIN(id) AS canonical_id,
         COUNT(*) AS cnt
  FROM "TrackMatch"
  GROUP BY "internalTrackId"
  HAVING COUNT(*) > 1
),
merged AS (
  SELECT g.canonical_id,
         (array_agg(tm."spotifyServiceTrackId")    FILTER (WHERE tm."spotifyServiceTrackId" IS NOT NULL))[1]    AS spotify_id,
         (array_agg(tm."youtubeServiceTrackId")    FILTER (WHERE tm."youtubeServiceTrackId" IS NOT NULL))[1]    AS youtube_id,
         (array_agg(tm."soundcloudServiceTrackId") FILTER (WHERE tm."soundcloudServiceTrackId" IS NOT NULL))[1] AS soundcloud_id,
         MAX(tm.confidence) AS confidence,
         CASE WHEN bool_or(tm.status = 'CONFIRMED')    THEN 'CONFIRMED'
              WHEN bool_or(tm.status = 'AUTO_MATCHED') THEN 'AUTO_MATCHED'
              ELSE MIN(tm.status)
         END AS status
  FROM grouped g
  JOIN "TrackMatch" tm ON tm."internalTrackId" = g."internalTrackId"
  GROUP BY g.canonical_id
)
UPDATE "TrackMatch" tm
SET "spotifyServiceTrackId"    = m.spotify_id,
    "youtubeServiceTrackId"    = m.youtube_id,
    "soundcloudServiceTrackId" = m.soundcloud_id,
    confidence                 = m.confidence,
    status                     = m.status,
    "updatedAt"                = NOW()
FROM merged m
WHERE tm.id = m.canonical_id;

DELETE FROM "TrackMatch" tm
USING "TrackMatch" tm2
WHERE tm."internalTrackId" = tm2."internalTrackId"
  AND tm.id > tm2.id;

-- 5. Delete orphaned InternalTrack rows (no ServiceTrack still references them).
DELETE FROM "InternalTrack" it
WHERE NOT EXISTS (SELECT 1 FROM "ServiceTrack" st WHERE st."internalTrackId" = it.id);

-- 6. Add an index on InternalTrack.isrc to speed up the new resolve-by-ISRC lookup.
CREATE INDEX IF NOT EXISTS "InternalTrack_isrc_idx" ON "InternalTrack" ("isrc");
