CREATE TABLE external_tracks (
    provider           TEXT NOT NULL DEFAULT 'spotify',
    provider_track_id  TEXT NOT NULL,
    title              TEXT NOT NULL,
    artist             TEXT NOT NULL,
    album              TEXT,
    duration_ms        INTEGER NOT NULL,
    isrc               TEXT,
    source             TEXT NOT NULL,
    matched_hash       TEXT,
    confidence         REAL,
    imported_at        INTEGER NOT NULL,
    position           INTEGER NOT NULL DEFAULT 0,
    artwork_url        TEXT,
    updated_at         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, provider_track_id, source)
);

INSERT INTO external_tracks
    (provider, provider_track_id, title, artist, album, duration_ms, isrc,
     source, matched_hash, confidence, imported_at, position, artwork_url, updated_at)
SELECT 'spotify', spotify_id, title, artist, album, duration_ms, isrc,
       source, matched_hash, confidence, imported_at, position, artwork_url, imported_at
FROM spotify_tracks;

DROP TABLE spotify_tracks;
CREATE INDEX idx_external_tracks_matched_hash ON external_tracks(matched_hash);

ALTER TABLE track_rejections ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE track_rejections ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE track_rejections SET updated_at = rejected_at;
