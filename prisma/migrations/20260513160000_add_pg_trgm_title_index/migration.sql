CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "ServiceTrack_titleNormalized_trgm_idx"
  ON "ServiceTrack" USING GIN ("titleNormalized" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ServiceTrack_artistNormalized_trgm_idx"
  ON "ServiceTrack" USING GIN ("artistNormalized" gin_trgm_ops);
