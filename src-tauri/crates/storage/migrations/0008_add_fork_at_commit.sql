-- Store the commit hash that was HEAD of `main` at fork time.
-- This is the merge base for future merge-fork-back operations.
-- NULL on playlists that were created fresh (not forked).
ALTER TABLE playlists ADD COLUMN forked_at_commit TEXT REFERENCES commits(hash);
