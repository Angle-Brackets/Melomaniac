use std::{path::PathBuf, sync::Arc};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use melomaniac_storage::{
    ArtworkLibraryEntry, BranchRecord, CasStore, CommitRecord, Database, Indexer,
    PlaylistMeta, PlaylistRecord, TrackRecord, TreeBlob,
};
use serde::Serialize;
use tauri::State;

fn bytes_to_data_url(bytes: &[u8]) -> String {
    let mime = if bytes.starts_with(b"\xFF\xD8") {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    format!("data:{};base64,{}", mime, BASE64.encode(bytes))
}

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct StorageState {
    pub cas: Arc<CasStore>,
    pub db: Arc<Database>,
    pub commit_author: Arc<std::sync::Mutex<String>>,
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PlaylistWithBranches {
    #[serde(flatten)]
    pub playlist: PlaylistRecord,
    pub branches: Vec<BranchRecord>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistBranchMeta {
    pub name:         String,
    pub description:  Option<String>,
    pub artwork_hash: Option<String>,
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

/// Recursively scan a directory for audio files and ingest all of them.
/// Returns the newly ingested (or already-present) TrackRecords.
#[tauri::command]
pub async fn library_import_folder(
    folder: String,
    storage: State<'_, StorageState>,
) -> Result<Vec<TrackRecord>, String> {
    const AUDIO_EXTS: &[&str] = &["mp3", "flac", "ogg", "wav", "m4a", "aac", "opus"];
    let mut paths: Vec<PathBuf> = Vec::new();

    fn walk(dir: &std::path::Path, exts: &[&str], out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, exts, out);
            } else if p.extension().and_then(|e| e.to_str()).map(|e| exts.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false) {
                out.push(p);
            }
        }
    }

    walk(std::path::Path::new(&folder), AUDIO_EXTS, &mut paths);

    let mut results = Vec::with_capacity(paths.len());
    for p in &paths {
        match melomaniac_storage::ingest::ingest_file(p, &storage.cas, &storage.db).await {
            Ok(record) => results.push(record),
            Err(e) => eprintln!("[import] skipped {}: {e}", p.display()),
        }
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

/// Remove a track from the library DB (the CAS blob is left intact for dedup safety).
#[tauri::command]
pub async fn library_remove_track(
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage.db.remove_track(&hash).await.map_err(|e| e.to_string())
}

/// Return a base64 data URL for the artwork of a track.
/// Returns an error if the track has no artwork or if it hasn't been ingested yet.
#[tauri::command]
pub async fn track_get_artwork(
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<String, String> {
    let record = storage
        .db
        .get_track(&hash)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("track not found: {hash}"))?;

    let artwork_hash = record
        .artwork_hash
        .ok_or_else(|| "no artwork for this track".to_string())?;

    let bytes = storage
        .cas
        .read_blob(&artwork_hash)
        .await
        .map_err(|e| e.to_string())?;
    Ok(bytes_to_data_url(&bytes))
}

/// All distinct artworks in the library — for the artwork picker grid.
#[tauri::command]
pub async fn get_artwork_library(
    storage: State<'_, StorageState>,
) -> Result<Vec<ArtworkLibraryEntry>, String> {
    storage.db.get_artwork_library().await.map_err(|e| e.to_string())
}

/// Read a CAS blob by artwork hash — returns a base64 data URL.
/// The separate bytes-only path for library_set_artwork still works via
/// get_artwork_blob_bytes (internal, not a command).
#[tauri::command]
pub async fn get_artwork_blob(
    artwork_hash: String,
    storage: State<'_, StorageState>,
) -> Result<String, String> {
    let bytes = storage.cas.read_blob(&artwork_hash).await.map_err(|e| e.to_string())?;
    Ok(bytes_to_data_url(&bytes))
}

/// Return raw bytes for an artwork blob — used internally when we need to
/// re-apply bytes to library_set_artwork / file_set_artwork.
#[tauri::command]
pub async fn get_artwork_blob_bytes(
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
    name:        String,
    description: Option<String>,
    storage:     State<'_, StorageState>,
) -> Result<PlaylistWithBranches, String> {
    let playlist = storage.db
        .create_playlist(&name, description.as_deref())
        .await.map_err(|e| e.to_string())?;

    // Write the initial commit so the branch is never in a NULL-head state.
    let tree = TreeBlob {
        v: 2,
        meta: PlaylistMeta {
            name: name.clone(),
            description: description.clone(),
            artwork_hash: None,
            extra: Default::default(),
        },
        tracks: vec![],
        includes: vec![],
        extra: Default::default(),
    };
    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(&storage, &playlist.id, "main", &json, Some("Initial commit".into())).await?;

    let branches = storage.db
        .get_branches(&playlist.id)
        .await.map_err(|e| e.to_string())?;

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

    // Stamp the new name into every branch's tree so future load_tree calls
    // get the fork's name instead of the original's.
    let source_name = storage.db.get_playlist(&source_id).await
        .ok().flatten()
        .map(|p| p.name)
        .unwrap_or_else(|| source_id.clone());
    let short_commit = playlist.forked_at_commit.as_deref()
        .map(|h| &h[..h.len().min(7)])
        .unwrap_or("unknown");
    let fork_msg = format!("Forked from {} @ {}", source_name, short_commit);

    let branches = storage.db.get_branches(&playlist.id).await.map_err(|e| e.to_string())?;
    for branch in &branches {
        let mut tree = load_tree(&storage, &playlist.id, &branch.name).await?;
        tree.meta.name = new_name.clone();
        let json = tree.to_json().map_err(|e| e.to_string())?;
        write_commit(&storage, &playlist.id, &branch.name, &json, Some(fork_msg.clone())).await?;
    }

    storage.db.update_playlist_cache(
        &playlist.id,
        &new_name,
        playlist.description.as_deref(),
        playlist.artwork_hash.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    let branches = storage.db.get_branches(&playlist.id).await.map_err(|e| e.to_string())?;
    Ok(PlaylistWithBranches { playlist, branches })
}

// ── Tree blob helpers ─────────────────────────────────────────────────────────

/// Load the current TreeBlob from a branch HEAD. Returns an empty tree for new
/// branches. On v1 blobs (no meta), migrates metadata from the SQL cache.
async fn load_tree(storage: &StorageState, playlist_id: &str, branch_name: &str) -> Result<TreeBlob, String> {
    let branch = storage.db
        .get_branch(playlist_id, branch_name)
        .await.map_err(|e| e.to_string())?;

    let mut tree = match branch.and_then(|b| b.head_commit) {
        None => TreeBlob::new(""),
        Some(commit_hash) => {
            // Resolve commit → tree_hash. Prefer SQL (covers synced commits that
            // exist only in the commits table, not as CAS blobs), then fall back to
            // reading the commit JSON from CAS (locally-written commits store it there).
            let tree_hash = if let Ok(Some(record)) = storage.db.get_commit(&commit_hash).await {
                record.tree_hash
            } else if let Ok(bytes) = storage.cas.read_blob(&commit_hash).await {
                let commit: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                commit["tree_hash"].as_str().ok_or("missing tree_hash in commit")?.to_string()
            } else {
                return Err(format!("commit not found: {commit_hash}"));
            };
            let tree_bytes = storage.cas.read_blob(&tree_hash).await.map_err(|e| e.to_string())?;
            TreeBlob::from_bytes(&tree_bytes).map_err(|e| e.to_string())?
        }
    };

    // v1 migration: populate meta from SQL cache so round-trips preserve name/artwork.
    if tree.meta.name.is_empty() {
        if let Ok(Some(pl)) = storage.db.get_playlist(playlist_id).await {
            tree.meta.name = pl.name;
            tree.meta.description = pl.description;
            tree.meta.artwork_hash = pl.artwork_hash;
            tree.v = 2;
        }
    }

    Ok(tree)
}

/// Write a tree JSON as a new CAS blob, create a commit, advance the branch HEAD.
async fn write_commit(
    storage:     &StorageState,
    playlist_id: &str,
    branch_name: &str,
    tree_json:   &str,
    message:     Option<String>,
) -> Result<String, String> {
    let db  = &storage.db;
    let cas = &storage.cas;

    let tree_hash = cas.write_blob(tree_json.as_bytes()).await.map_err(|e| e.to_string())?;

    let parent_hash = db.get_branch(playlist_id, branch_name)
        .await.map_err(|e| e.to_string())?
        .and_then(|b| b.head_commit);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let author = storage.commit_author.lock().unwrap().clone();
    let commit_body = serde_json::json!({
        "tree_hash": &tree_hash,
        "parent":    &parent_hash,
        "timestamp": timestamp,
        "device_id": &author,
        "message":   &message,
    }).to_string();

    let commit_hash = cas.write_blob(commit_body.as_bytes()).await.map_err(|e| e.to_string())?;

    let record = CommitRecord {
        hash: commit_hash.clone(),
        tree_hash: tree_hash.clone(),
        timestamp,
        device_id: author,
        message,
    };
    let parents: Vec<&str> = parent_hash.iter().map(String::as_str).collect();
    db.insert_commit(&record, &parents).await.map_err(|e| e.to_string())?;
    db.update_branch_head(playlist_id, branch_name, &commit_hash).await.map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

/// Write a commit with an explicit parent list — used for merge commits (two parents).
async fn write_commit_explicit(
    storage:     &StorageState,
    playlist_id: &str,
    branch_name: &str,
    tree_json:   &str,
    parents:     &[String],
    message:     Option<String>,
) -> Result<String, String> {
    let db  = &storage.db;
    let cas = &storage.cas;

    let tree_hash = cas.write_blob(tree_json.as_bytes()).await.map_err(|e| e.to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let author = storage.commit_author.lock().unwrap().clone();
    let first_parent = parents.first();
    let commit_body = serde_json::json!({
        "tree_hash": &tree_hash,
        "parent":    first_parent,
        "timestamp": timestamp,
        "device_id": &author,
        "message":   &message,
    }).to_string();

    let commit_hash = cas.write_blob(commit_body.as_bytes()).await.map_err(|e| e.to_string())?;

    let record = CommitRecord {
        hash: commit_hash.clone(),
        tree_hash,
        timestamp,
        device_id: author,
        message,
    };
    let parent_refs: Vec<&str> = parents.iter().map(String::as_str).collect();
    db.insert_commit(&record, &parent_refs).await.map_err(|e| e.to_string())?;
    db.update_branch_head(playlist_id, branch_name, &commit_hash).await.map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

async fn head_commit(storage: &StorageState, playlist_id: &str, branch_name: &str) -> Result<String, String> {
    storage.db.get_branch(playlist_id, branch_name)
        .await.map_err(|e| e.to_string())?
        .ok_or_else(|| format!("branch not found: {branch_name}"))
        .map(|b| b.head_commit.unwrap_or_default())
}

// ── Playlist track commands ───────────────────────────────────────────────────

/// TrackRecord enriched with per-playlist A/B loop points from the tree manifest.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PlaylistTrackRecord {
    #[serde(flatten)]
    pub record: TrackRecord,
    pub ab_start_ms: Option<u64>,
    pub ab_end_ms:   Option<u64>,
}

/// Resolve a branch HEAD → commit → tree blob → PlaylistTrackRecord[].
/// Returns in tree order with A/B loop points from the manifest.
#[tauri::command]
pub async fn playlist_get_tracks(
    playlist_id: String,
    branch_name: String,
    storage:     State<'_, StorageState>,
) -> Result<Vec<PlaylistTrackRecord>, String> {
    let tree = load_tree(&storage, &playlist_id, &branch_name).await?;
    let mut records = Vec::with_capacity(tree.tracks.len());
    for entry in &tree.tracks {
        let record = match storage.db.get_track(&entry.hash).await.map_err(|e| e.to_string())? {
            Some(r) => r,
            None if entry.title.is_some() => {
                // Track not yet in local library — synthesise a minimal record from
                // the metadata embedded in the tree blob by the originating device.
                TrackRecord {
                    hash:         entry.hash.clone(),
                    title:        entry.title.clone().unwrap_or_default(),
                    artist:       entry.artist.clone().unwrap_or_default(),
                    album:        entry.album.clone(),
                    artwork_hash: entry.artwork_hash.clone(),
                    duration_ms:  entry.duration_ms.unwrap_or(0),
                    favorited:    false,
                    ingested_at:  0,
                    source_url:   None,
                    mime_type:    entry.mime_type.clone(),
                }
            }
            None => continue,
        };
        records.push(PlaylistTrackRecord {
            record,
            ab_start_ms: entry.ab_start_ms,
            ab_end_ms:   entry.ab_end_ms,
        });
    }
    Ok(records)
}

/// Update a single track's A/B loop points in the active branch.
/// If the current HEAD commit is itself an A/B commit, it is amended in place
/// (new commit with the same grandparent) so dragging the markers doesn't
/// accumulate one commit per adjustment.
#[tauri::command]
pub async fn playlist_set_ab_loop(
    playlist_id: String,
    branch_name: String,
    track_hash:  String,
    ab_start_ms: Option<u64>,
    ab_end_ms:   Option<u64>,
    storage:     State<'_, StorageState>,
) -> Result<(), String> {
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    let entry = tree.tracks.iter_mut()
        .find(|e| e.hash == track_hash)
        .ok_or_else(|| format!("track {track_hash} not in playlist"))?;
    entry.ab_start_ms = ab_start_ms;
    entry.ab_end_ms   = ab_end_ms;

    let tree_json = tree.to_json().map_err(|e| e.to_string())?;

    let title = storage.db.get_track(&track_hash).await
        .map_err(|e| e.to_string())?
        .map(|r| r.title)
        .unwrap_or_else(|| track_hash[..8].to_string());

    fn fmt_ms(ms: u64) -> String {
        let total_s = ms / 1000;
        let m = total_s / 60;
        let s = total_s % 60;
        format!("{m}:{s:02}")
    }
    let start_fmt = ab_start_ms.map(fmt_ms).unwrap_or_else(|| "0:00".to_string());
    let end_fmt   = ab_end_ms.map(fmt_ms).unwrap_or_else(|| "?".to_string());
    let message = Some(format!("A/B: {title} [{start_fmt} → {end_fmt}]"));

    // Check whether HEAD is an A/B commit — if so, amend by using its parent.
    let db = &storage.db;
    let branch = db.get_branch(&playlist_id, &branch_name).await.map_err(|e| e.to_string())?;
    let parent_hash: Option<String> = match branch.and_then(|b| b.head_commit) {
        None => None,
        Some(head_hash) => {
            match storage.cas.read_blob(&head_hash).await {
                Ok(bytes) => {
                    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
                    let head_msg = v["message"].as_str().unwrap_or("");
                    if head_msg.starts_with("A/B:") {
                        // Amend: skip HEAD, use its parent
                        v["parent"].as_str().map(|s| s.to_string())
                    } else {
                        Some(head_hash)
                    }
                }
                Err(_) => Some(head_hash),
            }
        }
    };

    let cas = &storage.cas;
    let tree_hash = cas.write_blob(tree_json.as_bytes()).await.map_err(|e| e.to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let author = storage.commit_author.lock().unwrap().clone();
    let commit_body = serde_json::json!({
        "tree_hash": &tree_hash,
        "parent":    &parent_hash,
        "timestamp": timestamp,
        "device_id": &author,
        "message":   &message,
    }).to_string();

    let commit_hash = cas.write_blob(commit_body.as_bytes()).await.map_err(|e| e.to_string())?;

    let record = CommitRecord {
        hash: commit_hash.clone(),
        tree_hash,
        timestamp,
        device_id: author,
        message,
    };
    let parents: Vec<&str> = parent_hash.iter().map(String::as_str).collect();
    db.insert_commit(&record, &parents).await.map_err(|e| e.to_string())?;
    db.update_branch_head(&playlist_id, &branch_name, &commit_hash).await.map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove a single track hash from the tree and commit. Message is user-provided.
#[tauri::command]
pub async fn playlist_remove_track(
    playlist_id: String,
    branch_name: String,
    hash:        String,
    message:     String,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    // No-op if the track isn't in the playlist
    if !tree.tracks.iter().any(|t| t.hash == hash) {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    tree.tracks.retain(|t| t.hash != hash);
    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(&storage, &playlist_id, &branch_name, &json, Some(message)).await
}

/// Replace the track order with a new ordered list of hashes and auto-commit.
#[tauri::command]
pub async fn playlist_reorder_tracks(
    playlist_id:    String,
    branch_name:    String,
    ordered_hashes: Vec<String>,
    storage:        State<'_, StorageState>,
) -> Result<String, String> {
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    // No-op if the order is identical
    let current_hashes: Vec<String> = tree.tracks.iter().map(|t| t.hash.clone()).collect();
    if current_hashes.iter().map(String::as_str).collect::<Vec<_>>()
        == ordered_hashes.iter().map(String::as_str).collect::<Vec<_>>()
    {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    // Remember old positions before consuming tree.tracks
    let old_idx: std::collections::HashMap<&str, usize> = current_hashes.iter()
        .enumerate().map(|(i, h)| (h.as_str(), i)).collect();

    // Reorder by building a lookup map from the existing entries so extra fields survive.
    let entry_map: std::collections::HashMap<String, _> = tree.tracks
        .into_iter().map(|e| (e.hash.clone(), e)).collect();

    tree.tracks = ordered_hashes.iter()
        .filter_map(|h| entry_map.get(h).cloned())
        .collect();

    // The track with the largest position delta is the one the user dragged.
    let (moved_hash, moved_new_pos) = tree.tracks.iter().enumerate()
        .filter_map(|(new_i, e)| {
            let old_i = *old_idx.get(e.hash.as_str())?;
            let delta = (new_i as i64 - old_i as i64).unsigned_abs() as usize;
            Some((delta, new_i, e.hash.clone()))
        })
        .max_by_key(|(d, _, _)| *d)
        .map(|(_, new_i, h)| (h, new_i + 1))
        .unwrap_or_else(|| ("?".into(), 1));

    let title = storage.db.get_track(&moved_hash).await.ok().flatten()
        .map(|t| t.title)
        .unwrap_or_else(|| moved_hash[..moved_hash.len().min(7)].to_string());

    let msg = format!("Reorder: '{}' → #{}", title, moved_new_pos);
    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(&storage, &playlist_id, &branch_name, &json, Some(msg)).await
}

/// Rename a playlist: commits new meta to the tree blob AND updates the SQL cache.
#[tauri::command]
pub async fn playlist_rename(
    playlist_id: String,
    branch_name: String,
    new_name:    String,
    message:     String,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    // No-op if the name hasn't changed
    if tree.meta.name.trim() == new_name.trim() {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    let old_name = std::mem::replace(&mut tree.meta.name, new_name.clone());
    let json = tree.to_json().map_err(|e| e.to_string())?;

    let msg = if message.is_empty() {
        format!("Rename: '{}' → '{}'", old_name, new_name)
    } else {
        message
    };

    let commit_hash = write_commit(&storage, &playlist_id, &branch_name, &json, Some(msg)).await?;

    // Update SQL cache
    storage.db.update_playlist_cache(
        &playlist_id,
        &new_name,
        tree.meta.description.as_deref(),
        tree.meta.artwork_hash.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

/// Set (or clear) the description on a playlist branch and commit the change.
#[tauri::command]
pub async fn playlist_set_description(
    playlist_id: String,
    branch_name: String,
    description: Option<String>,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    let new_desc = description.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if tree.meta.description == new_desc {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    let msg = match &new_desc {
        Some(d) => format!("Description: {}", d),
        None    => "Clear description".into(),
    };
    tree.meta.description = new_desc.clone();
    let json = tree.to_json().map_err(|e| e.to_string())?;
    let commit_hash = write_commit(&storage, &playlist_id, &branch_name, &json, Some(msg)).await?;

    storage.db.update_playlist_cache(
        &playlist_id,
        &tree.meta.name,
        new_desc.as_deref(),
        tree.meta.artwork_hash.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

/// Return the tree-blob metadata (name, description, artwork hash) for a branch.
/// Reads from the live tree, not the SQL cache, so callers always get branch-specific values.
#[tauri::command]
pub async fn playlist_get_meta(
    playlist_id: String,
    branch_name: String,
    storage:     State<'_, StorageState>,
) -> Result<PlaylistBranchMeta, String> {
    let tree = load_tree(&storage, &playlist_id, &branch_name).await?;
    Ok(PlaylistBranchMeta {
        name:         tree.meta.name,
        description:  tree.meta.description,
        artwork_hash: tree.meta.artwork_hash,
    })
}

/// Write artwork bytes to CAS, embed the hash in the tree meta, and commit.
#[tauri::command]
pub async fn playlist_set_artwork(
    playlist_id:  String,
    branch_name:  String,
    image_bytes:  Vec<u8>,
    message:      String,
    storage:      State<'_, StorageState>,
) -> Result<String, String> {
    let artwork_hash = storage.cas
        .write_blob(&image_bytes)
        .await.map_err(|e| e.to_string())?;

    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    // No-op if the artwork hasn't changed
    if tree.meta.artwork_hash.as_deref() == Some(artwork_hash.as_str()) {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    tree.meta.artwork_hash = Some(artwork_hash.clone());
    let json = tree.to_json().map_err(|e| e.to_string())?;

    let msg = if message.is_empty() { "Set artwork".into() } else { message };
    let commit_hash = write_commit(&storage, &playlist_id, &branch_name, &json, Some(msg)).await?;

    // Update SQL cache
    storage.db.update_playlist_cache(
        &playlist_id,
        &tree.meta.name,
        tree.meta.description.as_deref(),
        Some(&artwork_hash),
    ).await.map_err(|e| e.to_string())?;

    Ok(commit_hash)
}

/// Return a base64 data URL for a playlist branch's artwork.
/// Reads from the branch tree so each branch can have independent artwork.
#[tauri::command]
pub async fn playlist_get_artwork(
    playlist_id: String,
    branch_name: String,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    let tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    let hash = tree.meta.artwork_hash
        .ok_or_else(|| "no artwork for this playlist branch".to_string())?;

    let bytes = storage.cas.read_blob(&hash).await.map_err(|e| e.to_string())?;
    Ok(bytes_to_data_url(&bytes))
}

/// Wipe all playlists, branches, and commits. Debug builds only.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn dev_reset_playlists(storage: State<'_, StorageState>) -> Result<(), String> {
    storage.db.reset_playlist_history().await.map_err(|e| e.to_string())
}

/// Delete a playlist and all its branches (CAS blobs are left intact).
#[tauri::command]
pub async fn playlist_delete(
    playlist_id: String,
    storage:     State<'_, StorageState>,
) -> Result<(), String> {
    storage.db.delete_playlist(&playlist_id).await.map_err(|e| e.to_string())
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

/// Append tracks to a branch, deduplicating against existing entries, and commit.
#[tauri::command]
pub async fn branch_append_tracks(
    playlist_id: String,
    branch_name: String,
    hashes:      Vec<String>,
    message:     Option<String>,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    append_tracks_inner(&storage, &playlist_id, &branch_name, &hashes, message).await
}

async fn append_tracks_inner(
    storage:     &StorageState,
    playlist_id: &str,
    branch_name: &str,
    hashes:      &[String],
    message:     Option<String>,
) -> Result<String, String> {
    let mut tree = load_tree(storage, playlist_id, branch_name).await?;

    let existing_hashes: std::collections::HashSet<String> =
        tree.tracks.iter().map(|e| e.hash.clone()).collect();

    let mut added_titles: Vec<String> = Vec::new();
    for hash in hashes {
        if !existing_hashes.contains(hash) {
            let track = storage.db.get_track(hash).await.ok().flatten();
            let title = track.as_ref().map(|t| t.title.clone())
                .unwrap_or_else(|| hash[..hash.len().min(7)].to_string());
            tree.tracks.push(melomaniac_storage::TrackEntry {
                hash: hash.clone(),
                title:       track.as_ref().map(|t| t.title.clone()),
                artist:      track.as_ref().map(|t| t.artist.clone()),
                album:       track.as_ref().and_then(|t| t.album.clone()),
                duration_ms: track.as_ref().map(|t| t.duration_ms),
                mime_type:   track.as_ref().and_then(|t| t.mime_type.clone()),
                artwork_hash: track.as_ref().and_then(|t| t.artwork_hash.clone()),
                ..Default::default()
            });
            added_titles.push(title);
        }
    }

    // No-op if every hash was already present
    if added_titles.is_empty() {
        return head_commit(storage, playlist_id, branch_name).await;
    }

    let auto_msg = match added_titles.len() {
        1 => format!("Add: {}", added_titles[0]),
        _ => {
            let mut lines = vec!["Add tracks:".to_string()];
            lines.extend(added_titles.iter().map(|t| format!("• {t}")));
            lines.join("\n")
        }
    };
    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(storage, playlist_id, branch_name, &json, Some(message.unwrap_or(auto_msg))).await
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

/// Delete a branch. Refuses to delete the last branch on a playlist.
#[tauri::command]
pub async fn branch_delete(
    playlist_id: String,
    name:        String,
    storage:     State<'_, StorageState>,
) -> Result<(), String> {
    let branches = storage.db.get_branches(&playlist_id).await.map_err(|e| e.to_string())?;
    if branches.len() <= 1 {
        return Err("cannot delete the last branch of a playlist".into());
    }
    storage.db.delete_branch(&playlist_id, &name).await.map_err(|e| e.to_string())
}

/// Rename a branch. No-op if the name is unchanged.
#[tauri::command]
pub async fn branch_rename(
    playlist_id: String,
    old_name:    String,
    new_name:    String,
    storage:     State<'_, StorageState>,
) -> Result<(), String> {
    if old_name.trim() == new_name.trim() { return Ok(()); }
    storage.db.rename_branch(&playlist_id, &old_name, &new_name).await.map_err(|e| e.to_string())
}

/// Create a new commit that restores the tree from a historical commit, advancing HEAD.
#[tauri::command]
pub async fn branch_revert_to(
    playlist_id:  String,
    branch_name:  String,
    commit_hash:  String,
    message:      String,
    storage:      State<'_, StorageState>,
) -> Result<String, String> {
    // Fetch the historical commit to get its tree hash
    let commit = storage.db.get_commit(&commit_hash)
        .await.map_err(|e| e.to_string())?
        .ok_or_else(|| format!("commit not found: {commit_hash}"))?;

    // No-op if HEAD already points at this tree
    let current = head_commit(&storage, &playlist_id, &branch_name).await?;
    if !current.is_empty() {
        if let Some(cur_commit) = storage.db.get_commit(&current).await.map_err(|e| e.to_string())? {
            if cur_commit.tree_hash == commit.tree_hash {
                return Ok(current);
            }
        }
    }

    let tree_bytes = storage.cas.read_blob(&commit.tree_hash).await.map_err(|e| e.to_string())?;
    let tree_json  = String::from_utf8(tree_bytes).map_err(|e| e.to_string())?;
    let msg = if message.is_empty() {
        format!("Revert to {}", &commit_hash[..7])
    } else {
        message
    };
    write_commit(&storage, &playlist_id, &branch_name, &tree_json, Some(msg)).await
}

/// All commits reachable from any branch of a playlist, with parent lists and branch refs.
#[derive(serde::Serialize)]
pub struct GraphNode {
    pub hash:      String,
    pub tree_hash: String,
    pub timestamp: i64,
    pub device_id: String,
    pub message:   Option<String>,
    pub parents:   Vec<String>,
    pub refs:      Vec<String>, // branch names whose HEAD is this commit
}

#[tauri::command]
pub async fn playlist_get_graph(
    playlist_id: String,
    storage:     State<'_, StorageState>,
) -> Result<Vec<GraphNode>, String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let branches = storage.db.get_branches(&playlist_id).await.map_err(|e| e.to_string())?;

    let mut refs: HashMap<String, Vec<String>> = HashMap::new();
    let mut frontier: VecDeque<String> = VecDeque::new();
    for b in &branches {
        if let Some(h) = &b.head_commit {
            refs.entry(h.clone()).or_default().push(b.name.clone());
            frontier.push_back(h.clone());
        }
    }

    let mut visited: HashSet<String> = HashSet::new();
    let mut nodes: Vec<GraphNode> = Vec::new();

    while let Some(hash) = frontier.pop_front() {
        if visited.contains(&hash) { continue; }
        visited.insert(hash.clone());

        let Some(commit) = storage.db.get_commit(&hash).await.map_err(|e| e.to_string())? else { continue };
        let parents = storage.db.get_commit_parents(&hash).await.map_err(|e| e.to_string())?;
        for p in &parents {
            if !visited.contains(p) { frontier.push_back(p.clone()); }
        }

        nodes.push(GraphNode {
            hash: commit.hash,
            tree_hash: commit.tree_hash,
            timestamp: commit.timestamp,
            device_id: commit.device_id,
            message: commit.message,
            parents,
            refs: refs.get(&hash).cloned().unwrap_or_default(),
        });
    }

    nodes.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(nodes)
}

/// Return hashes of tracks that are not referenced by any committed branch tree.
/// These are "stray" — ingested but never added to a playlist.
#[tauri::command]
pub async fn library_get_stray_tracks(
    storage: State<'_, StorageState>,
) -> Result<Vec<String>, String> {
    let tree_hashes = storage.db.get_active_tree_hashes().await.map_err(|e| e.to_string())?;

    // Collect every track hash that appears in any active tree blob
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for tree_hash in &tree_hashes {
        if let Ok(blob) = storage.cas.read_blob(tree_hash).await {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&blob) {
                if let Some(arr) = val["tracks"].as_array() {
                    for item in arr {
                        if let Some(h) = item["hash"].as_str() {
                            referenced.insert(h.to_string());
                        }
                    }
                }
            }
        }
    }

    let all = storage.db.get_all_tracks().await.map_err(|e| e.to_string())?;
    let stray: Vec<String> = all.into_iter()
        .filter(|t| !referenced.contains(&t.hash))
        .map(|t| t.hash)
        .collect();
    Ok(stray)
}

/// Merge one branch into another, writing a two-parent merge commit.
///
/// `strategy`:
///   - `"union"`        — keep target order, append tracks from source not already present
///   - `"intersection"` — keep only tracks present in both branches
#[tauri::command]
pub async fn branch_merge(
    playlist_id:          String,
    target_branch:        String,
    source_branch:        String,
    strategy:             String,
    message:              Option<String>,
    description_override: Option<String>,
    storage:              State<'_, StorageState>,
) -> Result<String, String> {
    merge_branches_inner(
        &storage, &playlist_id, &target_branch, &source_branch,
        &strategy, message, description_override,
    ).await
}

async fn merge_branches_inner(
    storage:              &StorageState,
    playlist_id:          &str,
    target_branch:        &str,
    source_branch:        &str,
    strategy:             &str,
    message:              Option<String>,
    description_override: Option<String>,
) -> Result<String, String> {
    use std::collections::HashSet;

    if target_branch == source_branch {
        return Err("source and target branch must be different".into());
    }

    let target_tree = load_tree(storage, playlist_id, target_branch).await?;
    let source_tree = load_tree(storage, playlist_id, source_branch).await?;

    let target_head = head_commit(storage, playlist_id, target_branch).await?;
    let source_head = head_commit(storage, playlist_id, source_branch).await?;

    if target_head == source_head {
        return Err("branches are already at the same commit — nothing to merge".into());
    }

    let mut merged_tree = target_tree.clone();

    let target_hashes: HashSet<String> = target_tree.tracks.iter().map(|t| t.hash.clone()).collect();
    let source_hashes: HashSet<String> = source_tree.tracks.iter().map(|t| t.hash.clone()).collect();

    merged_tree.tracks = match strategy {
        "intersection" => target_tree.tracks.into_iter()
            .filter(|t| source_hashes.contains(&t.hash))
            .collect(),
        _ => {
            let mut merged = target_tree.tracks;
            for track in source_tree.tracks {
                if !target_hashes.contains(&track.hash) {
                    merged.push(track);
                }
            }
            merged
        }
    };

    // Apply description resolution: caller passes the chosen value; None means keep target's.
    if let Some(desc) = description_override {
        merged_tree.meta.description = if desc.is_empty() { None } else { Some(desc) };
    }

    let auto_msg = format!("Merge '{}' into '{}'", source_branch, target_branch);
    let msg = message.unwrap_or(auto_msg);
    let json = merged_tree.to_json().map_err(|e| e.to_string())?;

    write_commit_explicit(
        storage, playlist_id, target_branch, &json,
        &[target_head, source_head],
        Some(msg),
    ).await
}

// ── Commit author ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_commit_author(storage: State<'_, StorageState>) -> String {
    storage.commit_author.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_commit_author(storage: State<'_, StorageState>, name: String) {
    *storage.commit_author.lock().unwrap() = name;
}

#[tauri::command]
pub fn library_get_storage_bytes(storage: State<'_, StorageState>) -> u64 {
    fn dir_size(path: &std::path::Path) -> u64 {
        let Ok(entries) = std::fs::read_dir(path) else { return 0 };
        entries.flatten().map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { p.metadata().map(|m| m.len()).unwrap_or(0) }
        }).sum()
    }
    dir_size(storage.cas.objects_dir())
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

    let indexer = Indexer::new(&cas, &db);

    let report = indexer.reconcile().await.map_err(|e| e.to_string())?;
    if report.stale_removed > 0 || report.orphan_blobs > 0 {
        eprintln!(
            "[storage] indexer: {} stale removed, {} orphan blobs",
            report.stale_removed, report.orphan_blobs
        );
    }

    indexer.rebuild_playlist_caches().await.map_err(|e| e.to_string())?;

    let default_author = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "desktop".into());

    Ok(StorageState {
        cas,
        db,
        commit_author: Arc::new(std::sync::Mutex::new(default_author)),
    })
}

// ── Dev seeding (debug builds only) ──────────────────────────────────────────

/// Recreate the "DevelopmentOnly" playlist from scratch with `track_hashes` on
/// the `main` branch.  Called once at app startup in debug builds so the carousel
/// and playback UI always have a real playlist to exercise.
///
/// The playlist is deleted and re-created every launch — it is a pure UI test
/// fixture and its commit history intentionally does not accumulate.
#[cfg(debug_assertions)]
pub async fn dev_seed_dev_playlist(
    storage:      &StorageState,
    track_hashes: &[String],
) -> Result<(), String> {
    use melomaniac_storage::{TrackEntry, TreeBlob};

    // Wipe any previous DevelopmentOnly playlist so history never accumulates.
    let existing = storage.db.get_all_playlists().await.map_err(|e| e.to_string())?;
    for pl in existing {
        if pl.name == "DevelopmentOnly" {
            storage.db.delete_playlist(&pl.id).await.map_err(|e| e.to_string())?;
        }
    }

    let pl = storage.db
        .create_playlist("DevelopmentOnly", None)
        .await.map_err(|e| e.to_string())?;

    let mut tree = TreeBlob::new("DevelopmentOnly");
    tree.tracks = track_hashes.iter()
        .map(|h| TrackEntry { hash: h.clone(), ..Default::default() })
        .collect();
    let json = tree.to_json().map_err(|e| e.to_string())?;

    // Single commit — this is the entire "history" for this playlist.
    write_commit(
        storage, &pl.id, "main", &json,
        Some(format!(
            "DevelopmentOnly: {} tracks from tests/audio/",
            track_hashes.len()
        )),
    ).await?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use melomaniac_storage::TrackRecord;

    // ── Fixtures ──────────────────────────────────────────────────────────────

    async fn setup() -> (StorageState, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cas = Arc::new(CasStore::new(tmp.path().join("objects")));
        let db  = Arc::new(
            Database::open(PathBuf::from(":memory:"))
                .await
                .expect("open db"),
        );
        db.migrate().await.expect("migrate");
        (StorageState {
            cas,
            db,
            commit_author: Arc::new(std::sync::Mutex::new("test".into())),
        }, tmp)
    }

    fn track_record(hash: &str, title: &str) -> TrackRecord {
        TrackRecord {
            hash:         hash.to_string(),
            title:        title.to_string(),
            artist:       "Artist".to_string(),
            album:        None,
            artwork_hash: None,
            duration_ms:  3000,
            favorited:    false,
            mime_type:    None,
            ingested_at:  0,
            source_url:   None,
        }
    }

    /// Create a playlist with a committed empty tree, return its id.
    async fn new_playlist(storage: &StorageState, name: &str) -> String {
        let pl = storage.db.create_playlist(name, None).await.expect("create_playlist");
        let tree = TreeBlob::new(name);
        let json = tree.to_json().expect("json");
        write_commit(storage, &pl.id, "main", &json, Some("Initial commit".into()))
            .await.expect("initial commit");
        pl.id
    }

    // ── branch_append_tracks ──────────────────────────────────────────────────

    #[tokio::test]
    async fn append_adds_new_tracks_and_commits() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "Song A")).await.unwrap();
        let h1 = append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();

        let tree = load_tree(&storage, &pid, "main").await.unwrap();
        assert_eq!(tree.tracks.len(), 1);
        assert_eq!(tree.tracks[0].hash, "aaa");

        // HEAD advanced
        let h2 = head_commit(&storage, &pid, "main").await.unwrap();
        assert_eq!(h1, h2);
    }

    #[tokio::test]
    async fn append_noop_on_all_duplicates() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "Song A")).await.unwrap();
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();
        let head_before = head_commit(&storage, &pid, "main").await.unwrap();

        // Adding the same hash again — must be a no-op (no new commit)
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();
        let head_after = head_commit(&storage, &pid, "main").await.unwrap();

        assert_eq!(head_before, head_after, "duplicate add must not create a new commit");
    }

    #[tokio::test]
    async fn append_partial_dedup_only_adds_new() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "Song A")).await.unwrap();
        storage.db.insert_track(&track_record("bbb", "Song B")).await.unwrap();
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();

        // Add both — only bbb should be new
        append_tracks_inner(&storage, &pid, "main",
            &["aaa".to_string(), "bbb".to_string()], None)
            .await.unwrap();

        let tree = load_tree(&storage, &pid, "main").await.unwrap();
        assert_eq!(tree.tracks.len(), 2);
    }

    #[tokio::test]
    async fn append_single_track_message() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;
        storage.db.insert_track(&track_record("aaa", "Song A")).await.unwrap();
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();

        let head = head_commit(&storage, &pid, "main").await.unwrap();
        let commit = storage.db.get_commit(&head).await.unwrap().unwrap();
        let msg = commit.message.as_deref().unwrap_or("");
        assert_eq!(msg, "Add: Song A");
    }

    #[tokio::test]
    async fn append_multi_track_message_uses_bullets() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;
        storage.db.insert_track(&track_record("aaa", "Song A")).await.unwrap();
        storage.db.insert_track(&track_record("bbb", "Song B")).await.unwrap();
        append_tracks_inner(&storage, &pid, "main",
            &["aaa".to_string(), "bbb".to_string()], None)
            .await.unwrap();

        let head = head_commit(&storage, &pid, "main").await.unwrap();
        let commit = storage.db.get_commit(&head).await.unwrap().unwrap();
        let msg = commit.message.as_deref().unwrap_or("");
        assert!(msg.contains("Add tracks:"), "expected header, got: {msg}");
        assert!(msg.contains("• Song A"),    "expected bullet A, got: {msg}");
        assert!(msg.contains("• Song B"),    "expected bullet B, got: {msg}");
    }

    // ── merge_branches_inner ──────────────────────────────────────────────────

    #[tokio::test]
    async fn merge_union_appends_source_unique_tracks() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "On Main")).await.unwrap();
        storage.db.insert_track(&track_record("bbb", "On Feature")).await.unwrap();

        // Seed main with "aaa"
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();

        // Create feature branch and add "bbb"
        storage.db.create_branch(&pid, "feature", None).await.unwrap();
        let feature_tree_json = {
            let mut t = load_tree(&storage, &pid, "main").await.unwrap();
            t.tracks.clear();
            t.tracks.push(melomaniac_storage::TrackEntry { hash: "bbb".to_string(), ..Default::default() });
            t.to_json().unwrap()
        };
        write_commit(&storage, &pid, "feature", &feature_tree_json, Some("Add bbb".into()))
            .await.unwrap();

        // Merge feature → main (union)
        merge_branches_inner(&storage, &pid, "main", "feature", "union", None, None)
            .await.unwrap();

        let tree = load_tree(&storage, &pid, "main").await.unwrap();
        let hashes: Vec<_> = tree.tracks.iter().map(|t| t.hash.as_str()).collect();
        assert!(hashes.contains(&"aaa"), "main's own track should remain");
        assert!(hashes.contains(&"bbb"), "feature's unique track should be appended");
        assert_eq!(hashes.len(), 2);
    }

    #[tokio::test]
    async fn merge_union_no_duplicates_for_shared_tracks() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "Shared")).await.unwrap();

        // Both branches have "aaa"
        append_tracks_inner(&storage, &pid, "main", &["aaa".to_string()], None)
            .await.unwrap();

        storage.db.create_branch(&pid, "feat", None).await.unwrap();
        let feat_tree_json = {
            let mut t = load_tree(&storage, &pid, "main").await.unwrap();
            t.to_json().unwrap()
        };
        write_commit(&storage, &pid, "feat", &feat_tree_json, Some("Copy".into()))
            .await.unwrap();

        merge_branches_inner(&storage, &pid, "main", "feat", "union", None, None)
            .await.unwrap();

        let tree = load_tree(&storage, &pid, "main").await.unwrap();
        assert_eq!(tree.tracks.len(), 1, "shared track must not be duplicated");
    }

    #[tokio::test]
    async fn merge_intersection_keeps_only_shared_tracks() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("aaa", "Shared")).await.unwrap();
        storage.db.insert_track(&track_record("bbb", "Main only")).await.unwrap();

        // main: [aaa, bbb], feature: [aaa]
        append_tracks_inner(&storage, &pid, "main",
            &["aaa".to_string(), "bbb".to_string()], None).await.unwrap();

        storage.db.create_branch(&pid, "feat", None).await.unwrap();
        let feat_json = {
            let mut t = load_tree(&storage, &pid, "main").await.unwrap();
            t.tracks.retain(|e| e.hash == "aaa");
            t.to_json().unwrap()
        };
        write_commit(&storage, &pid, "feat", &feat_json, Some("Only aaa".into()))
            .await.unwrap();

        merge_branches_inner(&storage, &pid, "main", "feat", "intersection", None, None)
            .await.unwrap();

        let tree = load_tree(&storage, &pid, "main").await.unwrap();
        let hashes: Vec<_> = tree.tracks.iter().map(|t| t.hash.as_str()).collect();
        assert_eq!(hashes, vec!["aaa"], "intersection must remove main-only track");
    }

    #[tokio::test]
    async fn merge_same_branch_is_error() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;
        let result = merge_branches_inner(&storage, &pid, "main", "main", "union", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn merge_produces_two_parent_commit() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("bbb", "B")).await.unwrap();
        storage.db.create_branch(&pid, "feat", None).await.unwrap();
        let feat_json = {
            let t = load_tree(&storage, &pid, "main").await.unwrap();
            let mut t = t;
            t.tracks.push(melomaniac_storage::TrackEntry { hash: "bbb".to_string(), ..Default::default() });
            t.to_json().unwrap()
        };
        write_commit(&storage, &pid, "feat", &feat_json, Some("Add bbb".into()))
            .await.unwrap();

        let merge_hash = merge_branches_inner(&storage, &pid, "main", "feat", "union", None, None)
            .await.unwrap();

        let parents = storage.db.get_commit_parents(&merge_hash).await.unwrap();
        assert_eq!(parents.len(), 2, "merge commit must record exactly two parents");
    }

    #[tokio::test]
    async fn merge_message_defaults_to_branch_names() {
        let (storage, _tmp) = setup().await;
        let pid = new_playlist(&storage, "P").await;

        storage.db.insert_track(&track_record("bbb", "B")).await.unwrap();
        storage.db.create_branch(&pid, "feat", None).await.unwrap();
        let feat_json = {
            let t = load_tree(&storage, &pid, "main").await.unwrap();
            let mut t = t;
            t.tracks.push(melomaniac_storage::TrackEntry { hash: "bbb".to_string(), ..Default::default() });
            t.to_json().unwrap()
        };
        write_commit(&storage, &pid, "feat", &feat_json, Some("Add bbb".into()))
            .await.unwrap();

        let merge_hash = merge_branches_inner(&storage, &pid, "main", "feat", "union", None, None)
            .await.unwrap();

        let commit = storage.db.get_commit(&merge_hash).await.unwrap().unwrap();
        assert_eq!(commit.message.as_deref(), Some("Merge 'feat' into 'main'"));
    }
}
