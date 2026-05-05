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
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct PlaylistRecord {
    pub id:          String,
    pub name:        String,
    pub description: Option<String>,
    pub created_at:  i64,
    pub forked_from: Option<String>,
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
            "INSERT INTO playlists (id, name, description, created_at, forked_from)
             VALUES (?, ?, ?, ?, NULL)"
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
            forked_from: None,
        })
    }

    pub async fn fork_playlist(
        &self,
        source_id: &str,
        new_name: &str,
    ) -> Result<PlaylistRecord, StorageError> {
        let new_id = uuid::Uuid::new_v4().to_string();
        let now    = unix_now();

        sqlx::query(
            "INSERT INTO playlists (id, name, description, created_at, forked_from)
             VALUES (?, ?, NULL, ?, ?)"
        )
        .bind(&new_id).bind(new_name).bind(now).bind(source_id)
        .execute(&self.pool).await?;

        // Copy all branches — they point to the same HEAD commits.
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
            id: new_id,
            name: new_name.to_string(),
            description: None,
            created_at: now,
            forked_from: Some(source_id.to_string()),
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

    pub async fn delete_playlist(&self, id: &str) -> Result<(), StorageError> {
        // ON DELETE CASCADE removes all branches automatically
        sqlx::query("DELETE FROM playlists WHERE id = ?")
            .bind(id).execute(&self.pool).await?;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
