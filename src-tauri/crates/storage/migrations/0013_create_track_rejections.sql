-- Persistent "this match is wrong" blacklist, deliberately provider-agnostic:
-- external_id is formatted "<provider>:<provider-native-id>" (e.g.
-- "spotify:3n3Ppam7vgaVa1iaRUc9Lp") rather than a spotify_tracks foreign key,
-- so a future provider (e.g. YouTube Music) can reuse this table without a
-- schema change. Applies regardless of match confidence -- even a
-- high-confidence algorithmic match can be flatly wrong and must stay
-- rejectable.
CREATE TABLE track_rejections (
    external_id  TEXT NOT NULL,
    hash         TEXT NOT NULL,
    rejected_at  INTEGER NOT NULL,
    PRIMARY KEY (external_id, hash)
);

CREATE INDEX idx_track_rejections_external_id ON track_rejections(external_id);
