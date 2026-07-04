-- `spotify_id` alone was the primary key, so a track present in more than one
-- Spotify playlist (or in both a playlist and Liked Songs) could only belong
-- to one `source` at a time — re-importing any OTHER playlist containing
-- that same track silently reassigned it away, shrinking every playlist's
-- track count except whichever was opened most recently. Scope the key to
-- (spotify_id, source) so the same track can be tracked independently per
-- playlist it actually appears in.
CREATE TABLE spotify_tracks_new (
    spotify_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    album        TEXT,
    duration_ms  INTEGER NOT NULL,
    isrc         TEXT,
    source       TEXT NOT NULL,
    matched_hash TEXT,
    confidence   REAL,
    imported_at  INTEGER NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    artwork_url  TEXT,
    PRIMARY KEY (spotify_id, source)
);

INSERT INTO spotify_tracks_new
    (spotify_id, title, artist, album, duration_ms, isrc, source, matched_hash, confidence, imported_at, position, artwork_url)
SELECT spotify_id, title, artist, album, duration_ms, isrc, source, matched_hash, confidence, imported_at, position, artwork_url
FROM spotify_tracks;

DROP TABLE spotify_tracks;
ALTER TABLE spotify_tracks_new RENAME TO spotify_tracks;

CREATE INDEX idx_spotify_tracks_matched_hash ON spotify_tracks(matched_hash);
