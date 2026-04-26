CREATE TABLE IF NOT EXISTS tracks (
    hash         TEXT    PRIMARY KEY,
    title        TEXT    NOT NULL,
    artist       TEXT    NOT NULL,
    album        TEXT,
    artwork_hash TEXT,
    duration_ms  INTEGER NOT NULL,
    favorited    INTEGER NOT NULL DEFAULT 0
);
