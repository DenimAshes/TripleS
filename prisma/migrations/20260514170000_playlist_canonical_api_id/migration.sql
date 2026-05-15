ALTER TABLE "Playlist"
  ADD COLUMN IF NOT EXISTS "apiId" TEXT,
  ADD COLUMN IF NOT EXISTS "permalink" TEXT;

CREATE INDEX IF NOT EXISTS "Playlist_service_apiId_idx" ON "Playlist" ("service", "apiId");
