-- 1) PlaylistTrackState: cleanup duplicates and add partial unique index on active rows.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "playlistId", "serviceTrackId"
      ORDER BY
        CASE WHEN "removedAt" IS NULL THEN 0 ELSE 1 END,
        "lastSeenAt" DESC,
        "firstSeenAt" DESC,
        id
    ) AS rn
  FROM "PlaylistTrackState"
  WHERE "removedAt" IS NULL
)
UPDATE "PlaylistTrackState" pts
SET "removedAt" = COALESCE(pts."lastSeenAt", NOW()),
    "lastSeenAt" = COALESCE(pts."lastSeenAt", NOW())
FROM ranked
WHERE pts.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistTrackState_playlist_track_active_uniq"
  ON "PlaylistTrackState" ("playlistId", "serviceTrackId")
  WHERE "removedAt" IS NULL;

-- 2) TrackMatch: partial unique per non-null target service id, after cleanup of duplicates.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "internalTrackId", "spotifyServiceTrackId"
      ORDER BY confidence DESC, "updatedAt" DESC, id
    ) AS rn
  FROM "TrackMatch"
  WHERE "spotifyServiceTrackId" IS NOT NULL
)
DELETE FROM "TrackMatch" tm USING ranked
WHERE tm.id = ranked.id AND ranked.rn > 1;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "internalTrackId", "youtubeServiceTrackId"
      ORDER BY confidence DESC, "updatedAt" DESC, id
    ) AS rn
  FROM "TrackMatch"
  WHERE "youtubeServiceTrackId" IS NOT NULL
)
DELETE FROM "TrackMatch" tm USING ranked
WHERE tm.id = ranked.id AND ranked.rn > 1;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "internalTrackId", "soundcloudServiceTrackId"
      ORDER BY confidence DESC, "updatedAt" DESC, id
    ) AS rn
  FROM "TrackMatch"
  WHERE "soundcloudServiceTrackId" IS NOT NULL
)
DELETE FROM "TrackMatch" tm USING ranked
WHERE tm.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "TrackMatch_internal_spotify_notnull_uniq"
  ON "TrackMatch" ("internalTrackId", "spotifyServiceTrackId")
  WHERE "spotifyServiceTrackId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "TrackMatch_internal_youtube_notnull_uniq"
  ON "TrackMatch" ("internalTrackId", "youtubeServiceTrackId")
  WHERE "youtubeServiceTrackId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "TrackMatch_internal_soundcloud_notnull_uniq"
  ON "TrackMatch" ("internalTrackId", "soundcloudServiceTrackId")
  WHERE "soundcloudServiceTrackId" IS NOT NULL;

-- 3) SyncJob: at most one active RUNNING job per rule.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "syncRuleId"
      ORDER BY "startedAt" DESC, id
    ) AS rn
  FROM "SyncJob"
  WHERE status = 'RUNNING' AND "finishedAt" IS NULL
)
UPDATE "SyncJob" sj
SET status = 'FAILED',
    "finishedAt" = NOW(),
    "errorMessage" = COALESCE("errorMessage",
      'Superseded RUNNING job marked FAILED during partial-unique migration')
FROM ranked
WHERE sj.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SyncJob_rule_running_uniq"
  ON "SyncJob" ("syncRuleId")
  WHERE status = 'RUNNING' AND "finishedAt" IS NULL;
