use std::{path::PathBuf, str::FromStr, time::{SystemTime, UNIX_EPOCH}};
use sqlx::{SqlitePool, sqlite::{SqliteConnectOptions, SqliteJournalMode}};
use crate::StorageError;

// ── Record types ──────────────────────────────────────────────────────────────
// These serialise directly to the frontend via Tauri. TypeScript types in
// src/store/types.ts use matching snake_case field names.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct TrackRecord {
    pub hash:         String,
    pub title:        String,
    pub artist:       String,
    pub album:        Option<String>,
    pub artwork_hash: Option<String>,
    pub duration_ms:  i64,   // sqlx maps INTEGER → i64; cast at the command boundary if needed
    pub favorited:    bool,
    /// IANA media type of the audio blob (e.g. `"audio/mpeg"`, `"audio/flac"`).
    /// NULL for pre-migration rows. Passed to iOS/Android as a format hint because
    /// CAS blob paths have no file extension.
    pub mime_type:    Option<String>,
    /// Unix seconds timestamp of when this track was first ingested. 0 for pre-migration rows.
    pub ingested_at:  i64,
    /// Original source URL if downloaded, NULL for locally imported files.
    pub source_url:   Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct PlaylistRecord {
    pub id:               String,
    pub name:             String,
    pub description:      Option<String>,
    pub created_at:       i64,
    /// Source playlist ID if this playlist was forked; NULL otherwise.
    pub forked_from:      Option<String>,
    /// HEAD commit of `main` on the source playlist at fork time.
    /// This is the merge-base for future merge-fork-back operations.
    pub forked_at_commit: Option<String>,
    /// Cached from the latest commit's tree blob; the blob is authoritative.
    pub artwork_hash:     Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct BranchRecord {
    pub id:          String,
    pub playlist_id: String,
    pub name:        String,
    pub head_commit: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct CommitRecord {
    pub hash:      String,
    pub tree_hash: String,
    pub timestamp: i64,
    pub device_id: String,
    pub message:   Option<String>,
}

// ── Database ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn open(db_path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)  // better concurrent read performance
            .foreign_keys(true);                   // enforce referential integrity

        let pool = SqlitePool::connect_with(opts).await?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<(), StorageError> {
        sqlx::migrate!().run(&self.pool).await?;
        Ok(())
    }

    // ── Tracks ────────────────────────────────────────────────────────────────

    pub async fn insert_track(&self, r: &TrackRecord) -> Result<(), StorageError> {
        // OR IGNORE: idempotent — re-ingesting a file with the same hash is a no-op
        sqlx::query(
            "INSERT OR IGNORE INTO tracks
             (hash, title, artist, album, artwork_hash, duration_ms, favorited, mime_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&r.hash).bind(&r.title).bind(&r.artist)
        .bind(&r.album).bind(&r.artwork_hash)
        .bind(r.duration_ms).bind(r.favorited).bind(&r.mime_type)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Upsert track metadata from a sync peer.
    ///
    /// Inserts a new row or updates an existing one, but never overwrites
    /// `favorited` or `ingested_at` — those are local-only fields.
    /// Metadata fields are only overwritten when the incoming value is "better"
    /// (non-empty title/artist, non-null artwork/album/mime_type, positive duration).
    pub async fn upsert_track_from_sync(&self, r: &TrackRecord) -> Result<(), StorageError> {
        sqlx::query(
            "INSERT INTO tracks (hash, title, artist, album, artwork_hash, duration_ms, favorited, mime_type)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT(hash) DO UPDATE SET
               title        = CASE WHEN NULLIF(excluded.title, '') IS NOT NULL THEN excluded.title ELSE tracks.title END,
               artist       = CASE WHEN NULLIF(excluded.artist, '') IS NOT NULL THEN excluded.artist ELSE tracks.artist END,
               album        = COALESCE(excluded.album, tracks.album),
               artwork_hash = COALESCE(excluded.artwork_hash, tracks.artwork_hash),
               duration_ms  = CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE tracks.duration_ms END,
               mime_type    = COALESCE(excluded.mime_type, tracks.mime_type)"
        )
        .bind(&r.hash).bind(&r.title).bind(&r.artist)
        .bind(&r.album).bind(&r.artwork_hash)
        .bind(r.duration_ms).bind(&r.mime_type)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Set ingested_at + source_url on a track. Only writes ingested_at if it is
    /// currently 0 (i.e. never set), so re-downloading the same track doesn't
    /// reset its NEW badge timer.
    pub async fn set_track_provenance(
        &self,
        hash:        &str,
        ingested_at: i64,
        source_url:  Option<&str>,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "UPDATE tracks SET
               ingested_at = CASE WHEN ingested_at = 0 THEN ? ELSE ingested_at END,
               source_url  = COALESCE(source_url, ?)
             WHERE hash = ?"
        )
        .bind(ingested_at).bind(source_url).bind(hash)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Delete track rows that arrived via sync (ingested_at = 0) and are no
    /// longer referenced by any current branch head tree. Called after playlist
    /// sync to clean up old-hash rows left by metadata edits on the source
    /// device (library_edit_track rewrites the audio blob → new hash, the old
    /// hash row is renamed in-place on the source but stays orphaned here).
    pub async fn prune_orphan_tracks(&self, cas: &crate::CasStore) -> Result<usize, StorageError> {
        let branches = self.get_all_branches_with_heads().await?;
        let mut active: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (_, head) in &branches {
            if let Ok(tree) = self.read_tree_for_commit(cas, head).await {
                for e in &tree.tracks {
                    active.insert(e.hash.clone());
                }
            }
        }

        // Fetch all sync-only track hashes then delete in Rust to avoid SQLite
        // variable-count limits on large NOT IN lists.
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT hash FROM tracks WHERE ingested_at = 0"
        )
        .fetch_all(&self.pool)
        .await?;

        let mut pruned = 0usize;
        for (hash,) in rows {
            if !active.contains(&hash) {
                sqlx::query("DELETE FROM tracks WHERE hash = ?")
                    .bind(&hash)
                    .execute(&self.pool)
                    .await?;
                pruned += 1;
            }
        }
        if pruned > 0 {
            eprintln!("[storage] prune_orphan_tracks: removed {pruned} orphaned row(s)");
        }
        Ok(pruned)
    }

    pub async fn get_all_tracks(&self) -> Result<Vec<TrackRecord>, StorageError> {
        Ok(sqlx::query_as::<_, TrackRecord>(
            "SELECT * FROM tracks ORDER BY artist, album, title"
        )
        .fetch_all(&self.pool).await?)
    }

    pub async fn get_track(&self, hash: &str) -> Result<Option<TrackRecord>, StorageError> {
        Ok(sqlx::query_as::<_, TrackRecord>("SELECT * FROM tracks WHERE hash = ?")
            .bind(hash).fetch_optional(&self.pool).await?)
    }

    pub async fn track_exists(&self, hash: &str) -> Result<bool, StorageError> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tracks WHERE hash = ?")
            .bind(hash).fetch_one(&self.pool).await?;
        Ok(count > 0)
    }

    pub async fn set_favorited(&self, hash: &str, favorited: bool) -> Result<(), StorageError> {
        sqlx::query("UPDATE tracks SET favorited = ? WHERE hash = ?")
            .bind(favorited).bind(hash).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn set_track_title(&self, hash: &str, title: &str) -> Result<(), StorageError> {
        sqlx::query("UPDATE tracks SET title = ? WHERE hash = ?")
            .bind(title).bind(hash).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_duration(&self, hash: &str, duration_ms: i64) -> Result<(), StorageError> {
        sqlx::query("UPDATE tracks SET duration_ms = ? WHERE hash = ?")
            .bind(duration_ms).bind(hash).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_artwork_hash(&self, hash: &str, artwork_hash: &str) -> Result<(), StorageError> {
        sqlx::query("UPDATE tracks SET artwork_hash = ? WHERE hash = ?")
            .bind(artwork_hash).bind(hash).execute(&self.pool).await?;
        Ok(())
    }

    /// Replace a track's hash and update its editable metadata fields atomically.
    pub async fn update_track_hash_and_metadata(
        &self,
        old_hash:  &str,
        new_hash:  &str,
        title:     &str,
        artist:    &str,
        album:     Option<&str>,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "UPDATE tracks SET hash = ?, title = ?, artist = ?, album = ? WHERE hash = ?"
        )
        .bind(new_hash).bind(title).bind(artist).bind(album).bind(old_hash)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Return all (branch_id, head_commit_hash) pairs for branches with a commit.
    pub async fn get_all_branches_with_heads(&self) -> Result<Vec<(String, String)>, StorageError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, head_commit FROM branches WHERE head_commit IS NOT NULL"
        )
        .fetch_all(&self.pool).await?;
        Ok(rows)
    }

    /// Advance multiple branch HEADs in a single transaction.
    /// Each tuple is (branch_id, new_commit_hash).
    pub async fn batch_update_branch_heads(
        &self,
        updates: &[(String, String)],
    ) -> Result<(), StorageError> {
        let mut tx = self.pool.begin().await?;
        for (branch_id, commit_hash) in updates {
            sqlx::query("UPDATE branches SET head_commit = ? WHERE id = ?")
                .bind(commit_hash).bind(branch_id)
                .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn remove_track(&self, hash: &str) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM tracks WHERE hash = ?")
            .bind(hash).execute(&self.pool).await?;
        Ok(())
    }

    /// Returns all track hashes — used by the indexer for CAS reconciliation.
    pub async fn all_hashes(&self) -> Result<Vec<String>, StorageError> {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT hash FROM tracks")
            .fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }

    // ── Playlists ─────────────────────────────────────────────────────────────

    pub async fn create_playlist(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<PlaylistRecord, StorageError> {
        let id  = uuid::Uuid::new_v4().to_string();
        let now = unix_now();

        sqlx::query(
            "INSERT INTO playlists (id, name, description, created_at, forked_from, forked_at_commit)
             VALUES (?, ?, ?, ?, NULL, NULL)"
        )
        .bind(&id).bind(name).bind(description).bind(now)
        .execute(&self.pool).await?;

        // Every new playlist gets a default `main` branch with no commits yet
        let branch_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO branches (id, playlist_id, name, head_commit) VALUES (?, ?, 'main', NULL)"
        )
        .bind(&branch_id).bind(&id).execute(&self.pool).await?;

        Ok(PlaylistRecord {
            id,
            name: name.to_string(),
            description: description.map(str::to_string),
            created_at: now,
            forked_from:      None,
            forked_at_commit: None,
            artwork_hash:     None,
        })
    }

    pub async fn fork_playlist(
        &self,
        source_id: &str,
        new_name:  &str,
    ) -> Result<PlaylistRecord, StorageError> {
        let new_id = uuid::Uuid::new_v4().to_string();
        let now    = unix_now();

        // Snapshot the current HEAD of `main` as the merge-base for future
        // merge-fork-back operations.
        let fork_at = self.get_branches(source_id).await?
            .into_iter()
            .find(|b| b.name == "main")
            .and_then(|b| b.head_commit);

        sqlx::query(
            "INSERT INTO playlists (id, name, description, created_at, forked_from, forked_at_commit)
             VALUES (?, ?, NULL, ?, ?, ?)"
        )
        .bind(&new_id).bind(new_name).bind(now).bind(source_id).bind(&fork_at)
        .execute(&self.pool).await?;

        // Copy all branches — they share the same HEAD commits as the source.
        // New commits on either side diverge independently from this point.
        for branch in self.get_branches(source_id).await? {
            let bid = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO branches (id, playlist_id, name, head_commit) VALUES (?, ?, ?, ?)"
            )
            .bind(&bid).bind(&new_id).bind(&branch.name).bind(&branch.head_commit)
            .execute(&self.pool).await?;
        }

        Ok(PlaylistRecord {
            id:               new_id,
            name:             new_name.to_string(),
            description:      None,
            created_at:       now,
            forked_from:      Some(source_id.to_string()),
            forked_at_commit: fork_at,
            artwork_hash:     None,
        })
    }

    pub async fn get_all_playlists(&self) -> Result<Vec<PlaylistRecord>, StorageError> {
        Ok(sqlx::query_as::<_, PlaylistRecord>("SELECT * FROM playlists ORDER BY name")
            .fetch_all(&self.pool).await?)
    }

    pub async fn get_playlist(&self, id: &str) -> Result<Option<PlaylistRecord>, StorageError> {
        Ok(sqlx::query_as::<_, PlaylistRecord>("SELECT * FROM playlists WHERE id = ?")
            .bind(id).fetch_optional(&self.pool).await?)
    }

    pub async fn rename_playlist(&self, id: &str, new_name: &str) -> Result<(), StorageError> {
        sqlx::query("UPDATE playlists SET name = ? WHERE id = ?")
            .bind(new_name).bind(id).execute(&self.pool).await?;
        Ok(())
    }

    /// Update the SQL cache columns from the latest committed tree blob's meta section.
    /// Called by the indexer after any commit or sync.
    pub async fn update_playlist_cache(
        &self,
        id:           &str,
        name:         &str,
        description:  Option<&str>,
        artwork_hash: Option<&str>,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "UPDATE playlists SET name = ?, description = ?, artwork_hash = ? WHERE id = ?"
        )
        .bind(name).bind(description).bind(artwork_hash).bind(id)
        .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn delete_playlist(&self, id: &str) -> Result<(), StorageError> {
        // ON DELETE CASCADE removes all branches automatically
        sqlx::query("DELETE FROM playlists WHERE id = ?")
            .bind(id).execute(&self.pool).await?;
        Ok(())
    }

    /// Wipe all playlists, branches, and commits. Used only in dev/test resets.
    pub async fn reset_playlist_history(&self) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM commit_parents").execute(&self.pool).await?;
        sqlx::query("DELETE FROM commits").execute(&self.pool).await?;
        sqlx::query("DELETE FROM branches").execute(&self.pool).await?;
        sqlx::query("DELETE FROM playlists").execute(&self.pool).await?;
        Ok(())
    }

    // ── Branches ─────────────────────────────────────────────────────────────

    pub async fn create_branch(
        &self,
        playlist_id: &str,
        name: &str,
        from_commit: Option<&str>,
    ) -> Result<BranchRecord, StorageError> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO branches (id, playlist_id, name, head_commit) VALUES (?, ?, ?, ?)"
        )
        .bind(&id).bind(playlist_id).bind(name).bind(from_commit)
        .execute(&self.pool).await?;

        Ok(BranchRecord {
            id,
            playlist_id: playlist_id.to_string(),
            name: name.to_string(),
            head_commit: from_commit.map(str::to_string),
        })
    }

    pub async fn get_branches(&self, playlist_id: &str) -> Result<Vec<BranchRecord>, StorageError> {
        Ok(sqlx::query_as::<_, BranchRecord>(
            "SELECT * FROM branches WHERE playlist_id = ? ORDER BY name"
        )
        .bind(playlist_id).fetch_all(&self.pool).await?)
    }

    pub async fn get_branch(
        &self,
        playlist_id: &str,
        name: &str,
    ) -> Result<Option<BranchRecord>, StorageError> {
        Ok(sqlx::query_as::<_, BranchRecord>(
            "SELECT * FROM branches WHERE playlist_id = ? AND name = ?"
        )
        .bind(playlist_id).bind(name).fetch_optional(&self.pool).await?)
    }

    pub async fn delete_branch(&self, playlist_id: &str, name: &str) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM branches WHERE playlist_id = ? AND name = ?")
            .bind(playlist_id).bind(name).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn rename_branch(&self, playlist_id: &str, old_name: &str, new_name: &str) -> Result<(), StorageError> {
        sqlx::query("UPDATE branches SET name = ? WHERE playlist_id = ? AND name = ?")
            .bind(new_name).bind(playlist_id).bind(old_name).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_branch_head(
        &self,
        playlist_id: &str,
        branch_name: &str,
        commit_hash: &str,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "UPDATE branches SET head_commit = ? WHERE playlist_id = ? AND name = ?"
        )
        .bind(commit_hash).bind(playlist_id).bind(branch_name)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Ensure a playlist row and branch row exist with the given IDs.
    /// Uses INSERT OR IGNORE so it is safe to call on already-imported playlists.
    pub async fn ensure_playlist_and_branch(
        &self,
        playlist_id: &str,
        playlist_name: &str,
        branch_name: &str,
    ) -> Result<(), StorageError> {
        let now = unix_now();
        sqlx::query(
            "INSERT OR IGNORE INTO playlists (id, name, description, created_at, forked_from, forked_at_commit)
             VALUES (?, ?, NULL, ?, NULL, NULL)"
        )
        .bind(playlist_id).bind(playlist_name).bind(now)
        .execute(&self.pool).await?;

        let branch_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO branches (id, playlist_id, name, head_commit) VALUES (?, ?, ?, NULL)"
        )
        .bind(&branch_id).bind(playlist_id).bind(branch_name)
        .execute(&self.pool).await?;

        Ok(())
    }

    // ── Commits ───────────────────────────────────────────────────────────────

    pub async fn insert_commit(
        &self,
        record: &CommitRecord,
        parents: &[&str],
    ) -> Result<(), StorageError> {
        sqlx::query(
            "INSERT OR IGNORE INTO commits (hash, tree_hash, timestamp, device_id, message)
             VALUES (?, ?, ?, ?, ?)"
        )
        .bind(&record.hash).bind(&record.tree_hash)
        .bind(record.timestamp).bind(&record.device_id).bind(&record.message)
        .execute(&self.pool).await?;

        for parent in parents {
            sqlx::query(
                "INSERT OR IGNORE INTO commit_parents (commit_hash, parent_hash) VALUES (?, ?)"
            )
            .bind(&record.hash).bind(parent)
            .execute(&self.pool).await?;
        }

        Ok(())
    }

    pub async fn get_commit_parents(&self, hash: &str) -> Result<Vec<String>, StorageError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT parent_hash FROM commit_parents WHERE commit_hash = ? ORDER BY rowid"
        )
        .bind(hash).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }

    pub async fn get_commit(&self, hash: &str) -> Result<Option<CommitRecord>, StorageError> {
        Ok(sqlx::query_as::<_, CommitRecord>("SELECT * FROM commits WHERE hash = ?")
            .bind(hash).fetch_optional(&self.pool).await?)
    }

    /// Walk the first-parent chain backwards from `from_hash`, returning up to `limit` commits.
    pub async fn get_commit_history(
        &self,
        from_hash: &str,
        limit: usize,
    ) -> Result<Vec<CommitRecord>, StorageError> {
        let mut history = Vec::with_capacity(limit);
        let mut current = Some(from_hash.to_string());

        while let Some(hash) = current {
            if history.len() >= limit { break; }

            match self.get_commit(&hash).await? {
                None => break,
                Some(commit) => {
                    // Follow the first parent only (standard --first-parent behaviour)
                    let parent: Option<(String,)> = sqlx::query_as(
                        "SELECT parent_hash FROM commit_parents WHERE commit_hash = ? LIMIT 1"
                    )
                    .bind(&commit.hash).fetch_optional(&self.pool).await?;

                    current = parent.map(|(h,)| h);
                    history.push(commit);
                }
            }
        }

        Ok(history)
    }

    /// Return the most recent commits across all branches, newest-first.
    pub async fn get_recent_commits(&self, limit: usize) -> Result<Vec<CommitRecord>, StorageError> {
        let rows = sqlx::query_as::<_, CommitRecord>(
            "SELECT * FROM commits ORDER BY timestamp DESC LIMIT ?"
        )
        .bind(limit as i64)
        .fetch_all(&self.pool).await?;
        Ok(rows)
    }

    /// All distinct tree_hashes referenced by current branch HEADs.
    pub async fn get_active_tree_hashes(&self) -> Result<Vec<String>, StorageError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT c.tree_hash
             FROM branches b
             JOIN commits c ON c.hash = b.head_commit
             WHERE b.head_commit IS NOT NULL"
        ).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }

    // ── Artwork library ───────────────────────────────────────────────────────

    /// Set the same artwork for an arbitrary list of track hashes in one transaction.
    pub async fn set_artwork_for_tracks(&self, hashes: &[String], artwork_hash: &str) -> Result<(), StorageError> {
        let mut tx = self.pool.begin().await?;
        for hash in hashes {
            sqlx::query("UPDATE tracks SET artwork_hash = ? WHERE hash = ?")
                .bind(artwork_hash).bind(hash)
                .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// All track hashes that reference a specific artwork blob.
    pub async fn get_track_hashes_by_artwork(&self, artwork_hash: &str) -> Result<Vec<String>, StorageError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT hash FROM tracks WHERE artwork_hash = ?"
        ).bind(artwork_hash).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }

    /// Swap every track that references `old_artwork_hash` to `new_artwork_hash`.
    pub async fn replace_artwork_hash(&self, old_artwork_hash: &str, new_artwork_hash: &str) -> Result<(), StorageError> {
        sqlx::query("UPDATE tracks SET artwork_hash = ? WHERE artwork_hash = ?")
            .bind(new_artwork_hash).bind(old_artwork_hash)
            .execute(&self.pool).await?;
        Ok(())
    }

    /// Distinct artworks across all tracks — for the artwork library picker.
    pub async fn get_artwork_library(&self) -> Result<Vec<ArtworkLibraryEntry>, StorageError> {
        Ok(sqlx::query_as::<_, ArtworkLibraryEntry>(
            "SELECT artwork_hash, album, artist, COUNT(*) as track_count
             FROM tracks WHERE artwork_hash IS NOT NULL
             GROUP BY artwork_hash ORDER BY album"
        )
        .fetch_all(&self.pool).await?)
    }

    // ── Sync ──────────────────────────────────────────────────────────────────

    pub async fn export_commit_chain(
        &self,
        playlist_id: &str,
        branch_name: &str,
    ) -> Result<Vec<CommitRecord>, StorageError> {
        let branch = self.get_branch(playlist_id, branch_name).await?;
        let head = match branch.and_then(|b| b.head_commit) {
            Some(h) => h,
            None => return Ok(vec![]),
        };

        let mut chain = Vec::new();
        let mut current = Some(head);

        while let Some(hash) = current {
            let commit = match self.get_commit(&hash).await? {
                Some(c) => c,
                None => break,
            };
            let parent: Option<(String,)> = sqlx::query_as(
                "SELECT parent_hash FROM commit_parents WHERE commit_hash = ? LIMIT 1"
            )
            .bind(&commit.hash).fetch_optional(&self.pool).await?;
            current = parent.map(|(h,)| h);
            chain.push(commit);
        }

        Ok(chain)
    }

    pub async fn import_commit_chain(
        &self,
        commits: &[CommitRecord],
    ) -> Result<(), StorageError> {
        let mut tx = self.pool.begin().await?;

        // Insert all commit rows first so parent FK references are satisfied.
        for commit in commits {
            sqlx::query(
                "INSERT OR IGNORE INTO commits (hash, tree_hash, timestamp, device_id, message)
                 VALUES (?, ?, ?, ?, ?)"
            )
            .bind(&commit.hash).bind(&commit.tree_hash)
            .bind(commit.timestamp).bind(&commit.device_id).bind(&commit.message)
            .execute(&mut *tx).await?;
        }

        // Link each commit to its parent (next element; chain is HEAD-first).
        for (i, commit) in commits.iter().enumerate() {
            if let Some(parent) = commits.get(i + 1) {
                sqlx::query(
                    "INSERT OR IGNORE INTO commit_parents (commit_hash, parent_hash) VALUES (?, ?)"
                )
                .bind(&commit.hash).bind(&parent.hash)
                .execute(&mut *tx).await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn find_common_ancestor(
        &self,
        hash_a: &str,
        hash_b: &str,
    ) -> Result<Option<String>, StorageError> {
        let mut ancestors_a = std::collections::HashSet::new();
        let mut current = Some(hash_a.to_string());
        while let Some(hash) = current {
            ancestors_a.insert(hash.clone());
            let parent: Option<(String,)> = sqlx::query_as(
                "SELECT parent_hash FROM commit_parents WHERE commit_hash = ? LIMIT 1"
            )
            .bind(&hash).fetch_optional(&self.pool).await?;
            current = parent.map(|(h,)| h);
        }

        let mut current = Some(hash_b.to_string());
        while let Some(hash) = current {
            if ancestors_a.contains(&hash) {
                return Ok(Some(hash));
            }
            let parent: Option<(String,)> = sqlx::query_as(
                "SELECT parent_hash FROM commit_parents WHERE commit_hash = ? LIMIT 1"
            )
            .bind(&hash).fetch_optional(&self.pool).await?;
            current = parent.map(|(h,)| h);
        }

        Ok(None)
    }

    pub async fn read_tree_for_commit(
        &self,
        cas: &crate::CasStore,
        commit_hash: &str,
    ) -> Result<crate::TreeBlob, StorageError> {
        let commit = self.get_commit(commit_hash).await?
            .ok_or_else(|| StorageError::BlobNotFound(commit_hash.to_string()))?;
        let bytes = cas.read_blob(&commit.tree_hash).await?;
        let tree = crate::TreeBlob::from_bytes(&bytes)?;
        Ok(tree)
    }

    pub async fn playlist_total_bytes(
        &self,
        cas: &crate::CasStore,
        playlist_id: &str,
        branch_name: &str,
    ) -> Result<u64, StorageError> {
        let chain = self.export_commit_chain(playlist_id, branch_name).await?;
        let head = match chain.into_iter().next() {
            Some(c) => c,
            None => return Ok(0),
        };
        let tree = self.read_tree_for_commit(cas, &head.hash).await?;
        let total = tree.tracks.iter().map(|t| {
            std::fs::metadata(cas.blob_path(&t.hash))
                .map(|m| m.len())
                .unwrap_or(0)
        }).sum();
        Ok(total)
    }

    // ── Play / skip stats ─────────────────────────────────────────────────────

    /// Record that a track was played to completion (or near completion).
    /// `duration_ms` is how long the user actually listened (usually the
    /// full track duration, but callers may pass the position at stop time).
    pub async fn record_play(&self, hash: &str, duration_ms: Option<i64>) -> Result<(), StorageError> {
        let now = unix_now();
        sqlx::query(
            "INSERT INTO plays (hash, played_at, duration_ms) VALUES (?, ?, ?)"
        )
        .bind(hash).bind(now).bind(duration_ms)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Record that the user skipped away from a track at `position_ms`.
    pub async fn record_skip(&self, hash: &str, position_ms: i64) -> Result<(), StorageError> {
        let now = unix_now();
        sqlx::query(
            "INSERT INTO skips (hash, skipped_at, position_ms) VALUES (?, ?, ?)"
        )
        .bind(hash).bind(now).bind(position_ms)
        .execute(&self.pool).await?;
        Ok(())
    }

    /// Return play/skip aggregate stats for a single track.
    pub async fn get_track_stats(&self, hash: &str) -> Result<TrackStats, StorageError> {
        let play_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM plays WHERE hash = ?"
        )
        .bind(hash).fetch_one(&self.pool).await?;

        let skip_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skips WHERE hash = ?"
        )
        .bind(hash).fetch_one(&self.pool).await?;

        let total_listen_ms: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(duration_ms), 0) FROM plays WHERE hash = ? AND duration_ms IS NOT NULL"
        )
        .bind(hash).fetch_one(&self.pool).await?;

        Ok(TrackStats { play_count, skip_count, total_listen_ms })
    }

    /// Return the top `limit` tracks ordered by play count descending.
    /// Returns (track_hash, TrackStats) pairs.
    pub async fn get_top_tracks(&self, limit: i64) -> Result<Vec<(String, TrackStats)>, StorageError> {
        // A single query with sub-selects avoids N+1 stats lookups.
        let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
            "SELECT t.hash,
                    COALESCE(p.play_count,       0) AS play_count,
                    COALESCE(s.skip_count,       0) AS skip_count,
                    COALESCE(p.total_listen_ms,  0) AS total_listen_ms
             FROM tracks t
             LEFT JOIN (
                 SELECT hash,
                        COUNT(*)                      AS play_count,
                        SUM(COALESCE(duration_ms, 0)) AS total_listen_ms
                 FROM plays
                 GROUP BY hash
             ) p ON p.hash = t.hash
             LEFT JOIN (
                 SELECT hash, COUNT(*) AS skip_count
                 FROM skips
                 GROUP BY hash
             ) s ON s.hash = t.hash
             WHERE COALESCE(p.play_count, 0) > 0
             ORDER BY play_count DESC
             LIMIT ?"
        )
        .bind(limit).fetch_all(&self.pool).await?;

        Ok(rows.into_iter().map(|(hash, play_count, skip_count, total_listen_ms)| {
            (hash, TrackStats { play_count, skip_count, total_listen_ms })
        }).collect())
    }
}

// ── TrackStats ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackStats {
    pub play_count:      i64,
    pub skip_count:      i64,
    pub total_listen_ms: i64,
}

// ── Artwork library entry ─────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ArtworkLibraryEntry {
    pub artwork_hash: String,
    pub album:        Option<String>,
    pub artist:       String,
    pub track_count:  i64,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    async fn mem_db() -> Database {
        let db = Database::open(PathBuf::from(":memory:")).await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn track(hash: &str) -> TrackRecord {
        TrackRecord {
            hash:         hash.to_string(),
            title:        "T".to_string(),
            artist:       "A".to_string(),
            album:        None,
            artwork_hash: None,
            duration_ms:  1000,
            favorited:    false,
            mime_type:    None,
            ingested_at:  0,
            source_url:   None,
        }
    }

    #[tokio::test]
    async fn set_track_provenance_sets_ingested_at() {
        let db = mem_db().await;
        db.insert_track(&track("abc")).await.unwrap();
        db.set_track_provenance("abc", 999, Some("https://example.com")).await.unwrap();

        let r = db.get_track("abc").await.unwrap().unwrap();
        assert_eq!(r.ingested_at, 999);
    }

    #[tokio::test]
    async fn set_track_provenance_does_not_overwrite_ingested_at() {
        let db = mem_db().await;
        db.insert_track(&track("abc")).await.unwrap();
        db.set_track_provenance("abc", 999, Some("https://first.com")).await.unwrap();
        db.set_track_provenance("abc", 1234, Some("https://second.com")).await.unwrap();

        let r = db.get_track("abc").await.unwrap().unwrap();
        assert_eq!(r.ingested_at, 999);
    }

    #[tokio::test]
    async fn set_track_provenance_source_url_not_overwritten() {
        let db = mem_db().await;
        db.insert_track(&track("abc")).await.unwrap();
        db.set_track_provenance("abc", 1, Some("https://first.com")).await.unwrap();
        db.set_track_provenance("abc", 2, Some("https://second.com")).await.unwrap();

        let r = db.get_track("abc").await.unwrap().unwrap();
        assert_eq!(r.source_url.as_deref(), Some("https://first.com"));
    }

    #[tokio::test]
    async fn get_recent_commits_ordered_by_timestamp_desc() {
        let db = mem_db().await;
        let playlist = db.create_playlist("p", None).await.unwrap();
        let branch = db.create_branch(&playlist.id, "feat", None).await.unwrap();

        let c1 = CommitRecord { hash: "h1".into(), tree_hash: "t1".into(), timestamp: 100, device_id: "d".into(), message: None };
        let c2 = CommitRecord { hash: "h2".into(), tree_hash: "t2".into(), timestamp: 200, device_id: "d".into(), message: None };
        let c3 = CommitRecord { hash: "h3".into(), tree_hash: "t3".into(), timestamp: 150, device_id: "d".into(), message: None };

        db.insert_commit(&c1, &[]).await.unwrap();
        db.insert_commit(&c2, &[]).await.unwrap();
        db.insert_commit(&c3, &[]).await.unwrap();
        db.update_branch_head(&playlist.id, &branch.name, "h2").await.unwrap();

        let recent = db.get_recent_commits(10).await.unwrap();
        assert_eq!(recent[0].hash, "h2");
        assert_eq!(recent[1].hash, "h3");
        assert_eq!(recent[2].hash, "h1");
    }

    #[tokio::test]
    async fn get_active_tree_hashes_returns_head_commit_tree_hashes() {
        let db = mem_db().await;
        let playlist = db.create_playlist("p", None).await.unwrap();

        let c1 = CommitRecord { hash: "h1".into(), tree_hash: "tree-a".into(), timestamp: 1, device_id: "d".into(), message: None };
        let c2 = CommitRecord { hash: "h2".into(), tree_hash: "tree-b".into(), timestamp: 2, device_id: "d".into(), message: None };

        db.insert_commit(&c1, &[]).await.unwrap();
        db.insert_commit(&c2, &[]).await.unwrap();

        // c1 is not a branch HEAD — only the auto-created main branch, point it at c2
        db.update_branch_head(&playlist.id, "main", "h2").await.unwrap();

        let hashes = db.get_active_tree_hashes().await.unwrap();
        assert!(hashes.contains(&"tree-b".to_string()));
        assert!(!hashes.contains(&"tree-a".to_string()));
    }

    // ── Sync tests ────────────────────────────────────────────────────────────

    fn commit(hash: &str, tree_hash: &str) -> CommitRecord {
        CommitRecord {
            hash:      hash.to_string(),
            tree_hash: tree_hash.to_string(),
            timestamp: 0,
            device_id: "test".to_string(),
            message:   None,
        }
    }

    #[tokio::test]
    async fn export_commit_chain_empty_branch() {
        let db = mem_db().await;
        let playlist = db.create_playlist("p", None).await.unwrap();
        // main branch has NULL head_commit after creation
        let chain = db.export_commit_chain(&playlist.id, "main").await.unwrap();
        assert!(chain.is_empty());
    }

    #[tokio::test]
    async fn export_commit_chain_single_commit() {
        let db = mem_db().await;
        let playlist = db.create_playlist("p", None).await.unwrap();
        let c = commit("aaa", "tree-aaa");
        db.insert_commit(&c, &[]).await.unwrap();
        db.update_branch_head(&playlist.id, "main", "aaa").await.unwrap();

        let chain = db.export_commit_chain(&playlist.id, "main").await.unwrap();
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].hash, "aaa");
    }

    #[tokio::test]
    async fn export_commit_chain_linear() {
        let db = mem_db().await;
        let playlist = db.create_playlist("p", None).await.unwrap();

        // A → B → C (C is HEAD)
        let ca = commit("A", "tA");
        let cb = commit("B", "tB");
        let cc = commit("C", "tC");
        db.insert_commit(&ca, &[]).await.unwrap();
        db.insert_commit(&cb, &["A"]).await.unwrap();
        db.insert_commit(&cc, &["B"]).await.unwrap();
        db.update_branch_head(&playlist.id, "main", "C").await.unwrap();

        let chain = db.export_commit_chain(&playlist.id, "main").await.unwrap();
        assert_eq!(chain.len(), 3);
        assert_eq!(chain[0].hash, "C");
        assert_eq!(chain[1].hash, "B");
        assert_eq!(chain[2].hash, "A");
    }

    #[tokio::test]
    async fn import_is_idempotent() {
        let db = mem_db().await;
        let commits = vec![commit("X", "tX"), commit("Y", "tY")];
        db.import_commit_chain(&commits).await.unwrap();
        db.import_commit_chain(&commits).await.unwrap(); // second import must not error

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM commits WHERE hash IN ('X', 'Y')")
            .fetch_one(&db.pool).await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn find_common_ancestor_direct() {
        let db = mem_db().await;
        // Chain: A → B → C and A → B → D; ancestor of C and D should be B
        let ca = commit("A", "tA");
        let cb = commit("B", "tB");
        let cc = commit("C", "tC");
        let cd = commit("D", "tD");
        db.insert_commit(&ca, &[]).await.unwrap();
        db.insert_commit(&cb, &["A"]).await.unwrap();
        db.insert_commit(&cc, &["B"]).await.unwrap();
        db.insert_commit(&cd, &["B"]).await.unwrap();

        let ancestor = db.find_common_ancestor("C", "D").await.unwrap();
        assert_eq!(ancestor, Some("B".to_string()));
    }

    #[tokio::test]
    async fn find_common_ancestor_none() {
        let db = mem_db().await;
        let c1 = commit("solo1", "t1");
        let c2 = commit("solo2", "t2");
        db.insert_commit(&c1, &[]).await.unwrap();
        db.insert_commit(&c2, &[]).await.unwrap();

        let ancestor = db.find_common_ancestor("solo1", "solo2").await.unwrap();
        assert_eq!(ancestor, None);
    }

    #[tokio::test]
    async fn cas_list_all_hashes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cas = crate::CasStore::new(dir.path().to_path_buf());

        let h1 = cas.write_blob(b"blob one").await.expect("write 1");
        let h2 = cas.write_blob(b"blob two").await.expect("write 2");
        let h3 = cas.write_blob(b"blob three").await.expect("write 3");

        let mut hashes = cas.list_all_hashes();
        hashes.sort();
        let mut expected = vec![h1, h2, h3];
        expected.sort();
        assert_eq!(hashes, expected);
    }
}
