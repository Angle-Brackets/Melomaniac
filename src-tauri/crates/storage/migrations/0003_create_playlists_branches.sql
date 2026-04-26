CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL,
    forked_from TEXT    REFERENCES playlists(id)
);

CREATE TABLE IF NOT EXISTS branches (
    id          TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    head_commit TEXT,
    UNIQUE(playlist_id, name)
);
