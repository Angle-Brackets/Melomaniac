use serde::{Deserialize, Serialize};

// ── Per-track entry ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackEntry {
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ab_start_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ab_end_ms: Option<u64>,
    /// Embedded track metadata so sync-receiving peers can populate their library
    /// without a separate /tracks round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_hash: Option<String>,
    /// Preserves unknown fields added by newer clients so round-trips never strip data.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ── Playlist identity metadata ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlaylistMeta {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub artwork_hash: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ── Sublist include entry (v2+) ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IncludeEntry {
    pub playlist_id: String,
    /// Branch to track; defaults to "main".
    #[serde(default)]
    pub branch: String,
    /// None = track branch HEAD live; Some(hash) = pinned snapshot.
    #[serde(default)]
    pub pinned_commit: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ── Tree blob ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeBlob {
    /// Schema version. v1 = tracks only; v2 = adds meta + includes.
    #[serde(default = "default_v")]
    pub v: u32,
    /// Playlist identity — name, description, artwork. Absent in v1 blobs (defaults to empty).
    #[serde(default)]
    pub meta: PlaylistMeta,
    #[serde(default)]
    pub tracks: Vec<TrackEntry>,
    /// Sublist includes (v2+). Absent in v1 blobs (defaults to empty).
    #[serde(default)]
    pub includes: Vec<IncludeEntry>,
    /// Preserves unknown top-level fields added by newer clients.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_v() -> u32 { 2 }

impl TreeBlob {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            v: 2,
            meta: PlaylistMeta { name: name.into(), ..Default::default() },
            tracks: vec![],
            includes: vec![],
            extra: Default::default(),
        }
    }

    pub fn to_json(&self) -> serde_json::Result<String> {
        serde_json::to_string(self)
    }

    pub fn from_bytes(bytes: &[u8]) -> serde_json::Result<Self> {
        serde_json::from_slice(bytes)
    }
}
