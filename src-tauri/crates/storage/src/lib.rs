pub mod cas;
pub mod db;
pub mod editor;
pub mod indexer;
pub mod ingest;

pub use cas::CasStore;
pub use db::{BranchRecord, CommitRecord, Database, PlaylistRecord, TrackRecord};
pub use editor::{AudioMetadata, FileEntry, read_cas_metadata};
pub use indexer::{IndexerReport, Indexer};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("blob not found: {0}")]
    BlobNotFound(String),

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("metadata error: {0}")]
    Metadata(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}
