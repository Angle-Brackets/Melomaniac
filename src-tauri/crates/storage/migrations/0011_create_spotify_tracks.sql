-- Imported Spotify tracks, persisted so they survive restarts and show up
-- in the Library as external rows until the user downloads them (or the
-- matcher silently links them to an existing local track).
CREATE TABLE spotify_tracks (
    spotify_id   TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    album        TEXT,
    duration_ms  INTEGER NOT NULL,
    isrc         TEXT,
    source       TEXT NOT NULL,   -- 'playlist:<id>' or 'liked'
    matched_hash TEXT,            -- NULL = external row; set = silently linked
    confidence   REAL,            -- NULL for manual links, algorithmic score otherwise
    imported_at  INTEGER NOT NULL
);

CREATE INDEX idx_spotify_tracks_matched_hash ON spotify_tracks(matched_hash);
