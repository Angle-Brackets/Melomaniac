use std::net::SocketAddr;

/// Typed HTTP route paths for the peer sync server.
///
/// Both the Axum router and all `SyncClient` implementations must use these
/// instead of raw string literals, so typos are caught at compile time.
pub mod routes {
    /// Axum path patterns (`:param` syntax) — use these in `Router::route`.
    pub const PING:            &str = "/ping";
    pub const MANIFEST:        &str = "/manifest";
    pub const HASHES:          &str = "/hashes";
    pub const TRACKS:          &str = "/tracks";
    pub const PAIR:            &str = "/pair";
    pub const BLOB:            &str = "/blob/:hash";
    pub const COMMITS:         &str = "/commits/:playlist_id/:branch_name";

    /// URL builders for HTTP clients — produce concrete paths with values filled in.
    pub fn blob(hash: &str) -> String {
        format!("/blob/{hash}")
    }
    pub fn commits(playlist_id: &str, branch: &str) -> String {
        format!("/commits/{playlist_id}/{branch}")
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub mod desktop;

/// The well-known port the sync HTTP server binds on.
/// Override with the `MELO_SYNC_PORT` environment variable.
pub fn sync_port() -> u16 {
    std::env::var("MELO_SYNC_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7700)
}

/// Delete all persisted sync state so the next launch starts completely fresh.
/// Only compiled in debug builds; call this before `NodeIdentity::load_or_create`.
#[cfg(debug_assertions)]
pub fn purge_dev_sync_state(data_dir: &std::path::Path) {
    for file in &["known_devices.json", "known_devices.json.sig", "sync_name.txt"] {
        let p = data_dir.join(file);
        if p.exists() {
            std::fs::remove_file(&p).ok();
            eprintln!("[sync] dev-purge: deleted {}", p.display());
        }
    }
    if let Ok(entry) = keyring::Entry::new("melomaniac", "sync_keypair") {
        match entry.delete_credential() {
            Ok(()) => eprintln!("[sync] dev-purge: cleared keyring"),
            Err(e) => eprintln!("[sync] dev-purge: keyring clear skipped ({e})"),
        }
    }
}

impl From<melomaniac_storage::StorageError> for SyncError {
    fn from(e: melomaniac_storage::StorageError) -> Self {
        SyncError::Io(std::io::Error::other(e.to_string()))
    }
}

#[cfg(target_os = "ios")]
pub mod ios;

pub mod identity;
pub(crate) mod merge;

pub use merge::diff_trees;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux", target_os = "ios"))]
pub(crate) mod http_server;

// ── NodeIdentity ──────────────────────────────────────────────────────────────

/// The cryptographic identity for this node (device).
///
/// Each installation generates a unique Ed25519 keypair on first run. The
/// secret key is stored in the OS keyring; the public key is freely shared
/// with peers during pairing and discovery.
pub struct NodeIdentity {
    pub public_key: ed25519_dalek::VerifyingKey,
    pub secret_key: ed25519_dalek::SigningKey,
    pub display_name: String,
}

// ── KnownDevice ───────────────────────────────────────────────────────────────

/// A trusted peer entry persisted in `known_devices.json`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KnownDevice {
    /// Base64-encoded 32-byte Ed25519 verifying (public) key.
    pub public_key_b64: String,
    pub display_name: String,
    /// Unix timestamp (seconds) when this device was paired.
    pub added_at: u64,
}

// ── PeerInfo ──────────────────────────────────────────────────────────────────

/// A live reachable peer discovered on the local network.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PeerInfo {
    /// Base64-encoded 32-byte Ed25519 verifying key.
    pub public_key_b64: String,
    pub display_name: String,
    /// Socket address at which the peer's sync HTTP server is reachable.
    pub addr: SocketAddr,
    /// Round-trip latency measured during discovery, if available.
    pub latency_ms: Option<u32>,
}

// ── TrackSyncRecord ───────────────────────────────────────────────────────────

/// Slim track record exchanged over the network so the receiving peer can
/// populate its local `tracks` table after downloading audio blobs.
/// Does not include `favorited`, `ingested_at`, or `source_url` — those are
/// local-only fields that should not be overwritten on the receiving side.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackSyncRecord {
    pub hash:         String,
    pub title:        String,
    pub artist:       String,
    pub album:        Option<String>,
    pub artwork_hash: Option<String>,
    pub duration_ms:  i64,
    pub mime_type:    Option<String>,
}

// ── BranchInfo ────────────────────────────────────────────────────────────────

/// Per-branch metadata included in a [`PlaylistManifest`].
/// Receivers use `track_hashes` to compute the unique set when selecting
/// multiple branches (avoiding double-counting shared tracks).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub track_count: usize,
    /// Sum of CAS audio-blob sizes for all tracks in this branch (bytes).
    pub size_bytes: u64,
    /// BLAKE3 hashes of every track in this branch's HEAD tree.
    /// Allows the receiver to deduplicate across branch selections.
    pub track_hashes: Vec<String>,
    /// HEAD commit hash for this branch — used by peers to diff without
    /// fetching blobs (None for empty branches).
    pub head_commit: Option<String>,
}

// ── PlaylistManifest ──────────────────────────────────────────────────────────

/// Manifest entry returned by `GET /manifest` on a peer's sync server.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistManifest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub branch_count: usize,
    pub track_count: usize,
    /// Sum of all audio blob sizes for the primary (main) branch in bytes.
    pub size_bytes: u64,
    /// Optional BLAKE3 hash of the playlist artwork blob.
    pub artwork_hash: Option<String>,
    /// The HEAD commit hash on the serving node's DAG for this playlist.
    pub head_commit: String,
    /// Per-branch detail (name + sizes + track hashes for dedup).
    #[serde(default)]
    pub branches: Vec<BranchInfo>,
}

// ── SyncProgress ─────────────────────────────────────────────────────────────

/// Progress notification sent from `sync_playlist` to the Tauri command layer.
pub struct SyncProgress {
    pub playlist_id: String,
    pub done: usize,
    pub total: usize,
}

// ── SyncReport ────────────────────────────────────────────────────────────────

/// Summary of a completed (or partially completed) sync operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncReport {
    pub blobs_fetched: usize,
    pub bytes_fetched: u64,
    /// Non-empty when the sync engine could not auto-merge and needs the user
    /// to resolve conflicts before the playlist is updated.
    pub conflicts: Vec<ConflictChunk>,
}

// ── PendingMerge ──────────────────────────────────────────────────────────────

/// Merge state stored in memory when sync_playlist returns conflicts.
/// Kept until the user resolves every ConflictChunk and calls resolve_merge_conflict.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingMerge {
    pub local_head:    String,
    pub peer_head:     String,
    pub ancestor_hash: Option<String>,
    pub branch_name:   String,
    pub conflicts:     Vec<ConflictChunk>,
}

// ── ConflictChunk ─────────────────────────────────────────────────────────────

/// A single conflict that could not be resolved automatically during a merge.
/// Streamed to the frontend for user resolution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConflictChunk {
    /// Stable identifier for this conflict (used to correlate user resolution).
    pub id: String,
    pub kind: ConflictKind,
    /// Our version of the conflicting data.
    pub ours: serde_json::Value,
    /// The peer's version of the conflicting data.
    pub theirs: serde_json::Value,
    /// Surrounding context to help the user understand the conflict.
    pub context: serde_json::Value,
}

/// The category of a conflict that requires user resolution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ConflictKind {
    /// Both sides reordered tracks differently.
    TrackOrder,
    /// One side deleted a track that the other side modified.
    TrackDeletedVsModified,
    /// Both sides edited the same metadata field with different values.
    MetadataEdit,
    /// Two branches were independently given the same name.
    BranchNameCollision,
    /// Both sides set different A/B loop points on the same track.
    AbLoopPoints,
}

// ── QrPayload ─────────────────────────────────────────────────────────────────

/// Payload encoded in a QR code for targeted (out-of-band) device pairing.
///
/// The initiating device displays this as a QR code; the accepting device
/// scans it and calls [`SyncBridge::accept_qr_pairing`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QrPayload {
    /// Base64-encoded 32-byte Ed25519 verifying key of the initiating device.
    pub public_key_b64: String,
    pub display_name: String,
    /// Optional `"ip:port"` hint. May be absent (e.g. across different networks).
    pub addr: Option<String>,
    /// Base64-encoded 32 random bytes used to authenticate the pairing handshake.
    pub token: String,
    /// Unix timestamp (seconds) after which this payload must be rejected.
    pub exp: u64,
}

// ── SyncError ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("no paired device found — complete pairing before syncing")]
    NotPaired,

    #[error("peer unreachable: {0}")]
    PeerUnreachable(String),

    #[error("authentication failed — peer rejected our identity")]
    AuthFailed,

    #[error("blob transfer failed: {0}")]
    BlobTransferFailed(String),

    #[error("merge conflict — user resolution required")]
    MergeConflict,

    #[error("identity error: {0}")]
    IdentityError(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

// ── SyncBridge trait ──────────────────────────────────────────────────────────

/// Cross-platform sync interface.
///
/// # Platform implementations
/// - **Desktop** (`desktop/`): mDNS-SD discovery + axum HTTP transfer server
/// - **iOS** (`ios.rs`): delegates to Swift via `NWBrowser` / `NWPathMonitor`
///
/// # Discovery lifecycle
/// 1. Call [`start_discovery`](Self::start_discovery) once on app launch.
/// 2. Optionally open the pairing window with
///    [`open_discovery_window`](Self::open_discovery_window) — this makes the
///    local node visible to other devices so they can initiate pairing.
/// 3. Call [`peers`](Self::peers) to enumerate reachable, trusted devices.
/// 4. Call [`stop_discovery`](Self::stop_discovery) before process exit.
pub trait SyncBridge: Send + Sync {
    // ── Discovery ─────────────────────────────────────────────────────────────

    /// Start background peer discovery. Idempotent — safe to call multiple times.
    fn start_discovery(&self) -> Result<(), SyncError>;

    /// Stop background peer discovery and free associated resources.
    fn stop_discovery(&self) -> Result<(), SyncError>;

    /// Returns a snapshot of currently reachable, trusted peers.
    fn peers(&self) -> Vec<PeerInfo>;

    // ── Pairing window ────────────────────────────────────────────────────────

    /// Broadcast this node's presence for `duration_secs` seconds so other
    /// devices can discover and initiate pairing with it.
    fn open_discovery_window(&self, duration_secs: u64);

    /// Close the pairing broadcast window early (e.g. the user dismissed the UI).
    fn close_discovery_window(&self);

    /// Returns `true` if the pairing broadcast window is currently open.
    fn is_discovery_open(&self) -> bool;

    // ── QR pairing ────────────────────────────────────────────────────────────

    /// Generate a fresh [`QrPayload`] to display as a QR code for pairing.
    /// The payload expires after a short window (implementation-defined, ~60 s).
    fn generate_qr_payload(&self) -> Result<QrPayload, SyncError>;

    /// Accept a scanned [`QrPayload`] from another device, verify the token,
    /// and add the sender to the local trust list.
    fn accept_qr_pairing(&self, payload: QrPayload) -> Result<(), SyncError>;

    // ── Trust list ────────────────────────────────────────────────────────────

    /// Returns all devices in the local trust list (may include offline peers).
    fn known_devices(&self) -> Vec<KnownDevice>;

    /// Remove a device from the trust list. The public key must be base64-encoded.
    fn remove_device(&self, public_key_b64: &str) -> Result<(), SyncError>;

    // ── Sync ──────────────────────────────────────────────────────────────────

    /// Pull the given playlist branch from the best available trusted peer.
    ///
    /// "Best" is implementation-defined (typically lowest latency). Returns a
    /// [`SyncReport`]; if `report.conflicts` is non-empty the caller must
    /// resolve them before the playlist is updated on disk.
    fn sync_playlist(
        &self,
        playlist_id: &str,
        branch_name: &str,
        progress_tx: Option<std::sync::mpsc::SyncSender<SyncProgress>>,
    ) -> Result<SyncReport, SyncError>;

    /// Perform a full bidirectional sync with a specific peer (identified by
    /// their base64 public key). Intended for desktop-to-desktop workflows
    /// where both sides have changes to exchange.
    fn sync_with_peer(&self, public_key_b64: &str) -> Result<SyncReport, SyncError>;

    /// Fetch the playlist manifest from a specific peer without performing a sync.
    /// Returns the list of playlists the peer is serving.
    fn get_peer_manifest(&self, public_key_b64: &str) -> Result<Vec<PlaylistManifest>, SyncError>;

    /// Refresh track metadata for shared playlists from a specific peer.
    ///
    /// Reads local branch trees to collect track hashes, POSTs them to the
    /// peer's `/tracks` endpoint, upserts any changed metadata (album name,
    /// artwork hash), and downloads artwork blobs not yet in local CAS.
    /// Returns the number of artwork blobs downloaded.
    ///
    /// Called by the auto-sync fast path when no HEAD commit changes are
    /// detected — ensures metadata-only edits propagate without new commits.
    fn refresh_peer_metadata(
        &self,
        public_key_b64: &str,
        playlist_ids: &[String],
    ) -> Result<u32, SyncError>;

    /// Returns this node's display fingerprint (e.g. `"AB12·CD34·EF56"`).
    fn fingerprint(&self) -> String;

    // ── Pending merge state ───────────────────────────────────────────────────

    /// Store merge state for a playlist that could not be auto-merged.
    fn set_pending_merge(&self, playlist_id: &str, merge: PendingMerge);

    /// Retrieve stored merge state, if any.
    fn pending_merge(&self, playlist_id: &str) -> Option<PendingMerge>;

    /// Clear stored merge state after the user resolves or dismisses it.
    fn clear_pending_merge(&self, playlist_id: &str);
}

// ── Serialization tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod serialization_tests {
    use super::*;

    #[test]
    fn qr_payload_json_roundtrip() {
        let payload = QrPayload {
            public_key_b64: "abc123".into(),
            display_name: "Alice".into(),
            addr: Some("192.168.1.42:7878".into()),
            token: "tok==".into(),
            exp: 9999999,
        };
        let json = serde_json::to_string(&payload).expect("serialize QrPayload");
        let decoded: QrPayload = serde_json::from_str(&json).expect("deserialize QrPayload");
        assert_eq!(decoded.public_key_b64, payload.public_key_b64);
        assert_eq!(decoded.display_name, payload.display_name);
        assert_eq!(decoded.addr, payload.addr);
        assert_eq!(decoded.token, payload.token);
        assert_eq!(decoded.exp, payload.exp);
    }

    #[test]
    fn conflict_chunk_all_kinds_serialize() {
        let kinds = [
            ConflictKind::TrackOrder,
            ConflictKind::TrackDeletedVsModified,
            ConflictKind::MetadataEdit,
            ConflictKind::BranchNameCollision,
            ConflictKind::AbLoopPoints,
        ];
        for kind in kinds {
            let chunk = ConflictChunk {
                id: "c1".into(),
                kind,
                ours: serde_json::Value::Null,
                theirs: serde_json::Value::Null,
                context: serde_json::Value::Null,
            };
            serde_json::to_string(&chunk).expect("serialize ConflictChunk");
        }
    }

    #[test]
    fn sync_report_empty_conflicts() {
        let report = SyncReport {
            blobs_fetched: 5,
            bytes_fetched: 1024,
            conflicts: vec![],
        };
        let json = serde_json::to_string(&report).expect("serialize SyncReport");
        let decoded: SyncReport = serde_json::from_str(&json).expect("deserialize SyncReport");
        assert_eq!(decoded.blobs_fetched, 5);
        assert_eq!(decoded.bytes_fetched, 1024);
        assert!(decoded.conflicts.is_empty());
    }
}
