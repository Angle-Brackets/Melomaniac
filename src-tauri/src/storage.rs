use std::{path::PathBuf, sync::Arc};

use melomaniac_storage::{
    ArtworkLibraryEntry, BranchRecord, CasStore, CommitRecord, Database, Indexer,
    PlaylistRecord, TrackRecord,
};
use serde::Serialize;
use tauri::State;

// ── Shared state ──────────────────────────────────────────────────────────────

pub struct StorageState {
    pub cas: Arc<CasStore>,
    pub db: Arc<Database>,
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PlaylistWithBranches {
    #[serde(flatten)]
    pub playlist: PlaylistRecord,
    pub branches: Vec<BranchRecord>,
}

// ── Library ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn library_get_all(storage: State<'_, StorageState>) -> Result<Vec<TrackRecord>, String> {
    storage.db.get_all_tracks().await.map_err(|e| e.to_string())
}

/// Ingest one or more local audio files into the CAS + metadata DB.
/// Paths that are already ingested are returned immediately (idempotent).
#[tauri::command]
pub async fn track_ingest_files(
    paths: Vec<String>,
    storage: State<'_, StorageState>,
) -> Result<Vec<TrackRecord>, String> {
    let mut results = Vec::with_capacity(paths.len());
    for p in &paths {
        let record = melomaniac_storage::ingest::ingest_file(
            &PathBuf::from(p),
            &storage.cas,
            &storage.db,
        )
        .await
        .map_err(|e| format!("{p}: {e}"))?;
        results.push(record);
    }
    Ok(results)
}

#[tauri::command]
pub async fn library_set_favorite(
    hash: String,
    favorited: bool,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .set_favorited(&hash, favorited)
        .await
        .map_err(|e| e.to_string())
}

/// Return the raw artwork bytes (JPEG or PNG) for a track.
/// Returns an error if the track has no artwork or if it hasn't been ingested yet.
#[tauri::command]
pub async fn track_get_artwork(
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<Vec<u8>, String> {
    let record = storage
        .db
        .get_track(&hash)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("track not found: {hash}"))?;

    let artwork_hash = record
        .artwork_hash
        .ok_or_else(|| "no artwork for this track".to_string())?;

    storage
        .cas
        .read_blob(&artwork_hash)
        .await
        .map_err(|e| e.to_string())
}

/// All distinct artworks in the library — for the artwork picker grid.
#[tauri::command]
pub async fn get_artwork_library(
    storage: State<'_, StorageState>,
) -> Result<Vec<ArtworkLibraryEntry>, String> {
    storage.db.get_artwork_library().await.map_err(|e| e.to_string())
}

/// Read a CAS blob by its artwork hash directly — used by the artwork picker thumbnails.
#[tauri::command]
pub async fn get_artwork_blob(
    artwork_hash: String,
    storage: State<'_, StorageState>,
) -> Result<Vec<u8>, String> {
    storage.cas.read_blob(&artwork_hash).await.map_err(|e| e.to_string())
}

// ── Playlists ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn playlist_get_all(
    storage: State<'_, StorageState>,
) -> Result<Vec<PlaylistWithBranches>, String> {
    let playlists = storage
        .db
        .get_all_playlists()
        .await
        .map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(playlists.len());
    for playlist in playlists {
        let branches = storage
            .db
            .get_branches(&playlist.id)
            .await
            .map_err(|e| e.to_string())?;
        result.push(PlaylistWithBranches { playlist, branches });
    }
    Ok(result)
}

#[tauri::command]
pub async fn playlist_create(
    name: String,
    description: Option<String>,
    storage: State<'_, StorageState>,
) -> Result<PlaylistWithBranches, String> {
    let playlist = storage
        .db
        .create_playlist(&name, description.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    let branches = storage
        .db
        .get_branches(&playlist.id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PlaylistWithBranches { playlist, branches })
}

#[tauri::command]
pub async fn playlist_fork(
    source_id: String,
    new_name: String,
    storage: State<'_, StorageState>,
) -> Result<PlaylistWithBranches, String> {
    let playlist = storage
        .db
        .fork_playlist(&source_id, &new_name)
        .await
        .map_err(|e| e.to_string())?;
    let branches = storage
        .db
        .get_branches(&playlist.id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PlaylistWithBranches { playlist, branches })
}

// ── Branches ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn branch_create(
    playlist_id: String,
    name: String,
    from_commit: Option<String>,
    storage: State<'_, StorageState>,
) -> Result<BranchRecord, String> {
    storage
        .db
        .create_branch(&playlist_id, &name, from_commit.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Write a new commit from a JSON tree blob, advance the branch HEAD.
///
/// `tree_json` must conform to the tree blob format:
/// `{ "tracks": [{ "hash": "<blake3>", "ab_start_ms": null, "ab_end_ms": null }] }`
#[tauri::command]
pub async fn branch_commit(
    playlist_id: String,
    branch_name: String,
    tree_json: String,
    device_id: String,
    message: Option<String>,
    storage: State<'_, StorageState>,
) -> Result<String, String> {
    let db = &storage.db;
    let cas = &storage.cas;

    // Write tree blob → tree_hash
    let tree_hash = cas
        .write_blob(tree_json.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    // Determine parent (current HEAD)
    let parent_hash = db
        .get_branch(&playlist_id, &branch_name)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|b| b.head_commit);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Build commit object, hash it, write as blob
    let commit_body = serde_json::json!({
        "tree_hash": &tree_hash,
        "parent":    &parent_hash,
        "timestamp": timestamp,
        "device_id": &device_id,
        "message":   &message,
    })
    .to_string();

    let commit_hash = cas
        .write_blob(commit_body.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let record = CommitRecord {
        hash: commit_hash.clone(),
        tree_hash,
        timestamp,
        device_id,
        message,
    };

    let parents: Vec<&str> = parent_hash.iter().map(String::as_str).collect();
    db.insert_commit(&record, &parents)
        .await
        .map_err(|e| e.to_string())?;
    db.update_branch_head(&playlist_id, &branch_name, &commit_hash)
        .await
        .map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

/// Return the most recent commits across all branches (newest-first).
/// `limit` defaults to 200 when 0.
#[tauri::command]
pub async fn get_recent_commits(
    limit:   usize,
    storage: State<'_, StorageState>,
) -> Result<Vec<CommitRecord>, String> {
    let cap = if limit == 0 { 200 } else { limit };
    storage.db.get_recent_commits(cap).await.map_err(|e| e.to_string())
}

/// Walk the first-parent chain from a branch HEAD, returning up to `limit` commits.
/// Pass `limit = 0` to get all commits (capped at 500 internally).
#[tauri::command]
pub async fn branch_get_history(
    playlist_id: String,
    branch_name: String,
    limit:       usize,
    storage:     State<'_, StorageState>,
) -> Result<Vec<CommitRecord>, String> {
    let branch = storage.db
        .get_branch(&playlist_id, &branch_name)
        .await.map_err(|e| e.to_string())?;
    let head = match branch.and_then(|b| b.head_commit) {
        Some(h) => h,
        None    => return Ok(vec![]),
    };
    let cap = if limit == 0 { 500 } else { limit };
    storage.db
        .get_commit_history(&head, cap)
        .await.map_err(|e| e.to_string())
}

// ── Initialisation helper ─────────────────────────────────────────────────────

pub async fn init_storage(app_data_dir: std::path::PathBuf) -> Result<StorageState, String> {
    let cas = Arc::new(CasStore::new(app_data_dir.join("objects")));
    let db = Arc::new(
        Database::open(app_data_dir.join("db.sqlite"))
            .await
            .map_err(|e| e.to_string())?,
    );
    db.migrate().await.map_err(|e| e.to_string())?;

    let report = Indexer::new(&cas, &db)
        .reconcile()
        .await
        .map_err(|e| e.to_string())?;

    if report.stale_removed > 0 || report.orphan_blobs > 0 {
        eprintln!(
            "[storage] indexer: {} stale removed, {} orphan blobs",
            report.stale_removed, report.orphan_blobs
        );
    }

    Ok(StorageState { cas, db })
}
