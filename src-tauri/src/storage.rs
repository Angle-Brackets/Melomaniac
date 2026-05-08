use std::{path::PathBuf, sync::Arc};

use melomaniac_storage::{
    ArtworkLibraryEntry, BranchRecord, CasStore, CommitRecord, Database, Indexer,
    PlaylistMeta, PlaylistRecord, TrackRecord, TreeBlob,
};
use serde::Serialize;
use tauri::State;

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Clone)]
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
    let branches = storage
        .db
        .get_branches(&playlist.id)
        .await
        .map_err(|e| e.to_string())?;
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
            let commit_bytes = storage.cas.read_blob(&commit_hash).await.map_err(|e| e.to_string())?;
            let commit: serde_json::Value = serde_json::from_slice(&commit_bytes).map_err(|e| e.to_string())?;
            let tree_hash = commit["tree_hash"].as_str().ok_or("missing tree_hash in commit")?.to_string();
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

    let commit_body = serde_json::json!({
        "tree_hash": &tree_hash,
        "parent":    &parent_hash,
        "timestamp": timestamp,
        "device_id": "desktop",
        "message":   &message,
    }).to_string();

    let commit_hash = cas.write_blob(commit_body.as_bytes()).await.map_err(|e| e.to_string())?;

    let record = CommitRecord {
        hash: commit_hash.clone(),
        tree_hash: tree_hash.clone(),
        timestamp,
        device_id: "desktop".into(),
        message,
    };
    let parents: Vec<&str> = parent_hash.iter().map(String::as_str).collect();
    db.insert_commit(&record, &parents).await.map_err(|e| e.to_string())?;
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

/// Resolve a branch HEAD → commit → tree blob → TrackRecord[]. Returns in tree order.
#[tauri::command]
pub async fn playlist_get_tracks(
    playlist_id: String,
    branch_name: String,
    storage:     State<'_, StorageState>,
) -> Result<Vec<TrackRecord>, String> {
    let tree = load_tree(&storage, &playlist_id, &branch_name).await?;
    let mut records = Vec::with_capacity(tree.tracks.len());
    for entry in &tree.tracks {
        if let Some(r) = storage.db.get_track(&entry.hash).await.map_err(|e| e.to_string())? {
            records.push(r);
        }
    }
    Ok(records)
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
    let current_hashes: Vec<&str> = tree.tracks.iter().map(|t| t.hash.as_str()).collect();
    if current_hashes == ordered_hashes.iter().map(String::as_str).collect::<Vec<_>>() {
        return head_commit(&storage, &playlist_id, &branch_name).await;
    }

    // Reorder by building a lookup map from the existing entries so extra fields survive.
    let entry_map: std::collections::HashMap<String, _> = tree.tracks
        .into_iter().map(|e| (e.hash.clone(), e)).collect();

    tree.tracks = ordered_hashes.into_iter()
        .filter_map(|h| entry_map.get(&h).cloned())
        .collect();

    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(&storage, &playlist_id, &branch_name, &json, Some("Reorder tracks".into())).await
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

/// Return the raw artwork bytes for a playlist branch.
/// Reads from the branch tree so each branch can have independent artwork.
#[tauri::command]
pub async fn playlist_get_artwork(
    playlist_id: String,
    branch_name: String,
    storage:     State<'_, StorageState>,
) -> Result<Vec<u8>, String> {
    let tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    let hash = tree.meta.artwork_hash
        .ok_or_else(|| "no artwork for this playlist branch".to_string())?;

    storage.cas.read_blob(&hash).await.map_err(|e| e.to_string())
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
    let mut tree = load_tree(&storage, &playlist_id, &branch_name).await?;

    let existing_hashes: std::collections::HashSet<String> =
        tree.tracks.iter().map(|e| e.hash.clone()).collect();

    for hash in &hashes {
        if !existing_hashes.contains(hash) {
            tree.tracks.push(melomaniac_storage::TrackEntry {
                hash: hash.clone(),
                ..Default::default()
            });
        }
    }

    let n = hashes.len();
    let auto_msg = format!("Add {} track{}", n, if n == 1 { "" } else { "s" });
    let json = tree.to_json().map_err(|e| e.to_string())?;
    write_commit(&storage, &playlist_id, &branch_name, &json, Some(message.unwrap_or(auto_msg))).await
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

    Ok(StorageState { cas, db })
}
