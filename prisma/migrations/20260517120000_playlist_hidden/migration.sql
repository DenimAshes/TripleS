-- Add a per-user "hide from picker" flag so playlists the user can't really
-- own (YT auto-playlists, SC liked playlists, leftovers from older refreshes)
-- can be pruned from the UI without losing existing sync rules.
ALTER TABLE "Playlist" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Playlist_userId_hidden_idx" ON "Playlist" ("userId", "hidden");

-- Backfill: mark known auto / non-owned playlists as hidden so existing
-- caches stop polluting the picker. Keeps rows around so any sync rule
-- that already references them keeps working.
UPDATE "Playlist"
SET "hidden" = true
WHERE
  -- YouTube Music auto-playlists addressed by stable id prefixes.
  ("service" = 'YOUTUBE' AND (
    "servicePlaylistId" IN ('LM', 'SE')
    OR "servicePlaylistId" LIKE 'RD%'
    OR "servicePlaylistId" LIKE 'OLAK5uy_%'
    OR "servicePlaylistId" LIKE 'MPREb_%'
    OR "servicePlaylistId" LIKE 'MPLA%'
    OR "servicePlaylistId" LIKE 'AMPYM%'
    OR "servicePlaylistId" LIKE 'ALPL%'
  ))
  -- SoundCloud: anything the API marked as not-writable is by definition
  -- not ours (likes vs. own playlists).
  OR ("service" = 'SOUNDCLOUD' AND "isWritable" = false);
