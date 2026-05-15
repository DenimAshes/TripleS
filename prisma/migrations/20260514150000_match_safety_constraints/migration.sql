ALTER TABLE "TrackMatchNegativeCache"
  ADD COLUMN "sourceMetadataHash" TEXT;

DELETE FROM "TrackMatch" a
USING "TrackMatch" b
WHERE a.ctid < b.ctid
  AND a."internalTrackId" = b."internalTrackId"
  AND a."spotifyServiceTrackId" IS NOT DISTINCT FROM b."spotifyServiceTrackId"
  AND a."youtubeServiceTrackId" IS NOT DISTINCT FROM b."youtubeServiceTrackId"
  AND a."soundcloudServiceTrackId" IS NOT DISTINCT FROM b."soundcloudServiceTrackId"
  AND (
    a."spotifyServiceTrackId" IS NOT NULL
    OR a."youtubeServiceTrackId" IS NOT NULL
    OR a."soundcloudServiceTrackId" IS NOT NULL
  );

DELETE FROM "TrackMatch" a
USING "TrackMatch" b
WHERE a.ctid < b.ctid
  AND a."internalTrackId" = b."internalTrackId"
  AND a."spotifyServiceTrackId" = b."spotifyServiceTrackId"
  AND a."spotifyServiceTrackId" IS NOT NULL;

DELETE FROM "TrackMatch" a
USING "TrackMatch" b
WHERE a.ctid < b.ctid
  AND a."internalTrackId" = b."internalTrackId"
  AND a."youtubeServiceTrackId" = b."youtubeServiceTrackId"
  AND a."youtubeServiceTrackId" IS NOT NULL;

DELETE FROM "TrackMatch" a
USING "TrackMatch" b
WHERE a.ctid < b.ctid
  AND a."internalTrackId" = b."internalTrackId"
  AND a."soundcloudServiceTrackId" = b."soundcloudServiceTrackId"
  AND a."soundcloudServiceTrackId" IS NOT NULL;

CREATE UNIQUE INDEX "TrackMatch_internalTrackId_spotifyServiceTrackId_key"
  ON "TrackMatch" ("internalTrackId", "spotifyServiceTrackId");

CREATE UNIQUE INDEX "TrackMatch_internalTrackId_youtubeServiceTrackId_key"
  ON "TrackMatch" ("internalTrackId", "youtubeServiceTrackId");

CREATE UNIQUE INDEX "TrackMatch_internalTrackId_soundcloudServiceTrackId_key"
  ON "TrackMatch" ("internalTrackId", "soundcloudServiceTrackId");
