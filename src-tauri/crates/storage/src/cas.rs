use std::path::PathBuf;
use tokio::fs;
use crate::StorageError;

pub struct CasStore {
    objects_dir: PathBuf,
}

impl CasStore {
    pub fn new(objects_dir: PathBuf) -> Self {
        Self { objects_dir }
    }

    /// BLAKE3 hash of `data` as a 64-char lowercase hex string. Pure — no I/O.
    pub fn hash(data: &[u8]) -> String {
        blake3::hash(data).to_hex().to_string()
    }

    /// Resolve hash → absolute path without touching the filesystem.
    pub fn blob_path(&self, hash: &str) -> PathBuf {
        // Split into <first-2>/<remaining-62> to avoid giant flat directories
        self.objects_dir.join(&hash[..2]).join(&hash[2..])
    }

    pub fn exists(&self, hash: &str) -> bool {
        self.blob_path(hash).exists()
    }

    /// Exposes the objects directory for the indexer's CAS walk.
    pub fn objects_dir(&self) -> &PathBuf {
        &self.objects_dir
    }

    /// Write `data` as a blob. Returns the hex hash.
    /// No-op if the blob already exists (deduplication).
    pub async fn write_blob(&self, data: &[u8]) -> Result<String, StorageError> {
        let hash = Self::hash(data);
        let path = self.blob_path(&hash);

        if path.exists() {
            return Ok(hash);
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Atomic write: write to .tmp first, then rename into the final path.
        // Prevents a half-written blob from being visible to concurrent readers.
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, data).await?;
        fs::rename(&tmp, &path).await?;

        Ok(hash)
    }

    pub async fn read_blob(&self, hash: &str) -> Result<Vec<u8>, StorageError> {
        let path = self.blob_path(hash);
        fs::read(&path)
            .await
            .map_err(|_| StorageError::BlobNotFound(hash.to_string()))
    }

    pub fn list_all_hashes(&self) -> Vec<String> {
        let Ok(prefix_dirs) = std::fs::read_dir(&self.objects_dir) else {
            return vec![];
        };
        let mut hashes = Vec::new();
        for prefix_entry in prefix_dirs.flatten() {
            let prefix_path = prefix_entry.path();
            if !prefix_path.is_dir() { continue; }
            let Ok(prefix_name) = prefix_entry.file_name().into_string() else { continue; };
            if prefix_name.len() != 2 { continue; }
            let Ok(suffix_entries) = std::fs::read_dir(&prefix_path) else { continue; };
            for suffix_entry in suffix_entries.flatten() {
                if !suffix_entry.path().is_file() { continue; }
                let Ok(suffix_name) = suffix_entry.file_name().into_string() else { continue; };
                if suffix_name.len() != 62 { continue; }
                let hash = format!("{}{}", prefix_name, suffix_name);
                if hash.chars().all(|c| c.is_ascii_hexdigit()) {
                    hashes.push(hash);
                }
            }
        }
        hashes
    }
}
