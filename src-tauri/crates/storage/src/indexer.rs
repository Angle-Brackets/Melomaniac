use std::collections::HashSet;
use crate::{CasStore, Database, StorageError};

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
