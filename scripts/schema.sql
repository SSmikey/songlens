-- SongLens: songs table + fuzzy-search indexes (pg_trgm)
-- Run once against the Supabase database. Safe to re-run (IF NOT EXISTS everywhere).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS songs (
  id serial PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL,
  year smallint,
  emotion text,
  lyrics_lead text NOT NULL,
  lyrics_hook text NOT NULL,
  lyrics_chorus text NOT NULL,
  full_lyrics text NOT NULL,      -- lead + hook + chorus, cleaned, used for main fuzzy search
  lyrics_skeleton text NOT NULL,  -- full_lyrics with Thai tone marks/vowel diacritics stripped
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Character-trigram indexes: language-agnostic, no Thai word segmentation needed.
CREATE INDEX IF NOT EXISTS songs_full_lyrics_trgm_idx
  ON songs USING gin (full_lyrics gin_trgm_ops);

CREATE INDEX IF NOT EXISTS songs_skeleton_trgm_idx
  ON songs USING gin (lyrics_skeleton gin_trgm_ops);

CREATE INDEX IF NOT EXISTS songs_title_trgm_idx
  ON songs USING gin (title gin_trgm_ops);
