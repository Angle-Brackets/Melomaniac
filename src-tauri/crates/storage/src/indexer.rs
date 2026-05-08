use std::collections::HashSet;
use crate::{CasStore, Database, StorageError, TreeBlob};

pub struct IndexerReport {
    pub stale_removed:  usize,
    pub orphan_blobs:   usize,
}

pub struct Indexer<'a> {
    cas: &'a CasStore,
    db:  &'a Database,
}

impl<'a> Indexer<'a> {
    pub fn new(cas: &'a CasStore, db: &'a Database) -> Self {
        Self { cas, db }
    }

    /// Reconcile CAS blobs against the SQLite tracks table.
    /// - Stale rows (DB entry with no corresponding blob) are deleted.
    /// - Orphan blobs (blob with no DB entry) are logged but left alone.
    pub async fn reconcile(&self) -> Result<IndexerReport, StorageError> {
        let db_hashes: HashSet<String> = self.db.all_hashes().await?.into_iter().collect();
        let cas_hashes = self.walk_cas()?;

        // Stale: in DB but missing from CAS — remove the metadata row
        let mut stale_removed = 0usize;
        for hash in &db_hashes {
            if !cas_hashes.contains(hash) {
                self.db.remove_track(hash).await?;
                stale_removed += 1;
            }
        }

        // Orphan: blob exists but no DB row — log and leave
        let mut orphan_blobs = 0usize;
        for hash in &cas_hashes {
            if !db_hashes.contains(hash) {
                eprintln!("[indexer] orphan blob: {hash}");
                orphan_blobs += 1;
            }
        }

        Ok(IndexerReport { stale_removed, orphan_blobs })
    }

    /// Rebuild the SQL cache columns (name, description, artwork_hash) for every
    /// playlist from its latest committed tree blob. Called on startup and after sync.
    pub async fn rebuild_playlist_caches(&self) -> Result<(), StorageError> {
        let playlists = self.db.get_all_playlists().await?;
        for playlist in playlists {
            let branches = self.db.get_branches(&playlist.id).await?;

            // Prefer main branch; fall back to first branch with a commit.
            let head_commit = branches.iter()
                .find(|b| b.name == "main")
                .or_else(|| branches.iter().find(|b| b.head_commit.is_some()))
                .and_then(|b| b.head_commit.clone());

            let Some(commit_hash) = head_commit else { continue; };

            let Ok(commit_bytes) = self.cas.read_blob(&commit_hash).await else { continue; };
            let Ok(commit) = serde_json::from_slice::<serde_json::Value>(&commit_bytes) else { continue; };
            let Some(tree_hash) = commit["tree_hash"].as_str() else { continue; };

            let Ok(tree_bytes) = self.cas.read_blob(tree_hash).await else { continue; };
            let Ok(tree) = TreeBlob::from_bytes(&tree_bytes) else { continue; };

            if tree.meta.name.is_empty() { continue; }

            self.db.update_playlist_cache(
                &playlist.id,
                &tree.meta.name,
                tree.meta.description.as_deref(),
                tree.meta.artwork_hash.as_deref(),
            ).await?;
        }
        Ok(())
    }

    /// Walk the CAS objects directory and return all blob hashes found.
    /// Skips `.tmp` files (incomplete atomic writes) and non-conforming filenames.
    fn walk_cas(&self) -> Result<HashSet<String>, StorageError> {
        let mut hashes = HashSet::new();
        let objects_dir = self.cas.objects_dir();

        let prefix_iter = match std::fs::read_dir(objects_dir) {
            Ok(it)  => it,
            // If the objects directory doesn't exist yet there are simply no blobs.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(hashes),
            Err(e)  => return Err(e.into()),
        };

        for prefix_entry in prefix_iter {
            let prefix_entry = prefix_entry?;
            if !prefix_entry.file_type()?.is_dir() { continue; }

            let prefix = prefix_entry.file_name();
            let prefix_str = prefix.to_string_lossy();
            if prefix_str.len() != 2 { continue; }

            for blob_entry in std::fs::read_dir(prefix_entry.path())? {
                let blob_entry = blob_entry?;
                let name = blob_entry.file_name();
                let name_str = name.to_string_lossy();

                // Skip in-progress atomic writes
                if name_str.ends_with(".tmp") { continue; }
                if name_str.len() != 62 { continue; }

                let hash = format!("{prefix_str}{name_str}");
                hashes.insert(hash);
            }
        }

        Ok(hashes)
    }
}
