CREATE TABLE IF NOT EXISTS commits (
    hash      TEXT    PRIMARY KEY,
    tree_hash TEXT    NOT NULL,
    timestamp INTEGER NOT NULL,
    device_id TEXT    NOT NULL,
    message   TEXT
);

-- Root commits have zero rows here; normal commits one; merge commits two.
CREATE TABLE IF NOT EXISTS commit_parents (
    commit_hash TEXT NOT NULL REFERENCES commits(hash) ON DELETE CASCADE,
    parent_hash TEXT NOT NULL REFERENCES commits(hash) ON DELETE RESTRICT,
    PRIMARY KEY (commit_hash, parent_hash)
);
