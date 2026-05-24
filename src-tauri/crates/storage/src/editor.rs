use std::{path::Path, sync::Arc};
use serde::{Deserialize, Serialize};

use crate::{CasStore, CommitRecord, Database, StorageError};

// ── Public types ──────────────────────────────────────────────────────────────

/// Unified audio metadata — covers ID3v2, Vorbis comments, iTunes atoms.
/// `duration_ms`, `format`, and `file_size` are read-only (ignored on write).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMetadata {
    pub title:        Option<String>,
    pub artist:       Option<String>,
    pub album:        Option<String>,
    pub album_artist: Option<String>,
    pub year:         Option<u32>,
    pub track_number: Option<u32>,
    pub track_total:  Option<u32>,
    pub disc_number:  Option<u32>,
    pub disc_total:   Option<u32>,
    pub genre:        Option<String>,
    pub composer:     Option<String>,
    pub comment:      Option<String>,
    pub lyrics:       Option<String>,
    pub bpm:          Option<u32>,
    pub copyright:    Option<String>,
    // Read-only — populated on read, ignored on write
    pub duration_ms:  u64,
    pub format:       String,
    pub file_size:    Option<u64>,
}

/// Lightweight entry returned by `scan_directory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path:        String,
    pub filename:    String,
    pub format:      String,
    pub size_bytes:  u64,
    pub title:       Option<String>,
    pub artist:      Option<String>,
    pub album:       Option<String>,
    pub duration_ms: u64,
}

// Internal — not exposed outside this module
struct BranchHeadUpdate {
    branch_id:       String,
    new_commit_hash: String,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Read all metadata from any audio file path on disk.
pub async fn read_metadata(path: &Path) -> Result<AudioMetadata, StorageError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || read_metadata_sync(&path))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))?
}

/// Write metadata back to an arbitrary audio file on disk (non-CAS).
pub async fn write_metadata_to_file(
    path: &Path,
    metadata: &AudioMetadata,
) -> Result<(), StorageError> {
    let path     = path.to_path_buf();
    let metadata = metadata.clone();
    tokio::task::spawn_blocking(move || apply_lofty_tags(&path, &metadata))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))?
}

/// List all audio files in `path` (non-recursive) with basic metadata.
pub async fn scan_directory(path: &Path) -> Result<Vec<FileEntry>, StorageError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || scan_directory_sync(&path))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))?
}

/// Read metadata from a CAS library track (by hash).
/// The blob has no file extension so it is written to a temp file first.
pub async fn read_cas_metadata(
    hash: &str,
    cas:  &Arc<CasStore>,
    db:   &Arc<Database>,
) -> Result<AudioMetadata, StorageError> {
    let track = db.get_track(hash).await?
        .ok_or_else(|| StorageError::BlobNotFound(hash.to_string()))?;

    let ext   = mime_to_ext(track.mime_type.as_deref().unwrap_or("audio/mpeg")).to_string();
    let bytes = cas.read_blob(hash).await?;

    let tmp = std::env::temp_dir()
        .join(format!("melomaniac_read_{}.{}", uuid::Uuid::new_v4(), ext));

    tokio::fs::write(&tmp, &bytes).await?;

    let path = tmp.clone();
    let result = tokio::task::spawn_blocking(move || read_metadata_sync(&path))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))?;

    tokio::fs::remove_file(&tmp).await.ok();
    result
}

/// Edit a library track already in CAS:
///   1. Read the blob, apply new tags, compute new BLAKE3 hash.
///   2. Write the new blob to CAS.
///   3. Update the DB track record.
///   4. Patch all branch trees in parallel (each in its own tokio task).
///   5. Commit each affected branch in a single batch DB transaction.
///
/// Returns the new track hash. If the tags produce no byte-level change the
/// original hash is returned unchanged.
pub async fn edit_cas_track(
    old_hash: &str,
    metadata: &AudioMetadata,
    cas:      &Arc<CasStore>,
    db:       &Arc<Database>,
) -> Result<String, StorageError> {
    // Look up the track so we know its mime_type for the temp-file extension.
    let track = db.get_track(old_hash).await?
        .ok_or_else(|| StorageError::BlobNotFound(old_hash.to_string()))?;

    let ext = mime_to_ext(track.mime_type.as_deref().unwrap_or("audio/mpeg")).to_string();

    // Read → patch tags → new bytes
    let original  = cas.read_blob(old_hash).await?;
    let new_bytes = apply_metadata_to_bytes(original, ext, metadata.clone()).await?;

    // Compute the new blob hash
    let new_hash = CasStore::hash(&new_bytes);

    // No effective change — nothing to commit
    if new_hash == old_hash {
        return Ok(new_hash.to_string());
    }

    // Store the new blob
    cas.write_blob(&new_bytes).await?;

    // Update the tracks table
    db.update_track_hash_and_metadata(
        old_hash,
        &new_hash,
        metadata.title.as_deref().unwrap_or(&track.title),
        metadata.artist.as_deref().unwrap_or(&track.artist),
        metadata.album.as_deref().or(track.album.as_deref()),
    ).await?;

    // Patch every branch tree that references the old hash — parallel
    let commit_msg = format!(
        "Edit metadata: {}",
        metadata.title.as_deref().unwrap_or(&track.title),
    );
    patch_trees_parallel(old_hash, &new_hash, &commit_msg, cas, db).await?;

    Ok(new_hash)
}

/// Store artwork bytes as a standalone CAS blob and update the track's `artwork_hash`.
/// Returns the new artwork hash.
pub async fn set_cas_artwork(
    track_hash:  &str,
    image_bytes: Vec<u8>,
    cas:         &Arc<CasStore>,
    db:          &Arc<Database>,
) -> Result<String, StorageError> {
    let track = db.get_track(track_hash).await?
        .ok_or_else(|| StorageError::BlobNotFound(track_hash.to_string()))?;
    let artwork_hash = cas.write_blob(&image_bytes).await?;
    db.update_artwork_hash(track_hash, &artwork_hash).await?;
    let msg = format!("Update artwork: {}", track.title);
    commit_branches_for_artwork(&[track_hash.to_string()], &msg, cas, db).await?;
    Ok(artwork_hash)
}

/// Set the same artwork for an explicit list of track hashes.
/// Writes the image blob once and bulk-updates the DB.
pub async fn set_artwork_for_track_list(
    hashes:      Vec<String>,
    image_bytes: Vec<u8>,
    cas:         &Arc<CasStore>,
    db:          &Arc<Database>,
) -> Result<(String, Vec<String>), StorageError> {
    if hashes.is_empty() {
        return Err(StorageError::Metadata("no tracks specified".into()));
    }
    let artwork_hash = cas.write_blob(&image_bytes).await?;
    db.set_artwork_for_tracks(&hashes, &artwork_hash).await?;
    let msg = if hashes.len() == 1 {
        let title = db.get_track(&hashes[0]).await?.map(|t| t.title).unwrap_or_default();
        format!("Update artwork: {title}")
    } else {
        let mut titles = Vec::with_capacity(hashes.len());
        for h in &hashes {
            let title = db.get_track(h).await?.map(|t| t.title).unwrap_or_default();
            titles.push(format!("• {title}"));
        }
        format!("Update artwork: {} tracks\n{}", hashes.len(), titles.join("\n"))
    };
    commit_branches_for_artwork(&hashes, &msg, cas, db).await?;
    Ok((artwork_hash, hashes))
}

/// Replace an existing artwork blob across all tracks that share it.
/// Returns `(new_artwork_hash, affected_track_hashes)`.
pub async fn replace_cas_artwork(
    old_artwork_hash: &str,
    image_bytes:      Vec<u8>,
    cas:              &Arc<CasStore>,
    db:               &Arc<Database>,
) -> Result<(String, Vec<String>), StorageError> {
    let affected = db.get_track_hashes_by_artwork(old_artwork_hash).await?;
    let new_hash = cas.write_blob(&image_bytes).await?;
    db.replace_artwork_hash(old_artwork_hash, &new_hash).await?;
    let msg = if affected.len() == 1 {
        let title = db.get_track(&affected[0]).await?.map(|t| t.title).unwrap_or_default();
        format!("Replace artwork: {title}")
    } else {
        let mut titles = Vec::with_capacity(affected.len());
        for h in &affected {
            let title = db.get_track(h).await?.map(|t| t.title).unwrap_or_default();
            titles.push(format!("• {title}"));
        }
        format!("Replace artwork: {} tracks\n{}", affected.len(), titles.join("\n"))
    };
    commit_branches_for_artwork(&affected, &msg, cas, db).await?;
    Ok((new_hash, affected))
}

/// Embed artwork bytes into an audio file on disk (non-CAS, replaces any existing cover).
pub async fn file_set_artwork(
    path:        &Path,
    image_bytes: Vec<u8>,
) -> Result<(), StorageError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || embed_picture_in_file(&path, &image_bytes))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))?
}

// ── Parallel tree patching ────────────────────────────────────────────────────

async fn patch_trees_parallel(
    old_hash:   &str,
    new_hash:   &str,
    commit_msg: &str,
    cas:        &Arc<CasStore>,
    db:         &Arc<Database>,
) -> Result<(), StorageError> {
    let branches = db.get_all_branches_with_heads().await?;

    let mut set = tokio::task::JoinSet::new();
    for (branch_id, head_commit) in branches {
        let old = old_hash.to_string();
        let new = new_hash.to_string();
        let msg = commit_msg.to_string();
        let cas = Arc::clone(cas);
        let db  = Arc::clone(db);
        set.spawn(async move {
            patch_single_branch(branch_id, head_commit, old, new, msg, cas, db).await
        });
    }

    let mut updates: Vec<BranchHeadUpdate> = Vec::new();
    while let Some(result) = set.join_next().await {
        match result {
            Ok(Ok(Some(u))) => updates.push(u),
            Ok(Ok(None))    => {}
            Ok(Err(e))      => eprintln!("[editor] branch patch error: {e}"),
            Err(e)          => eprintln!("[editor] branch task error: {e}"),
        }
    }

    if !updates.is_empty() {
        let pairs: Vec<(String, String)> = updates
            .into_iter()
            .map(|u| (u.branch_id, u.new_commit_hash))
            .collect();
        db.batch_update_branch_heads(&pairs).await?;
    }

    Ok(())
}

async fn patch_single_branch(
    branch_id:   String,
    head_commit: String,
    old_hash:    String,
    new_hash:    String,
    commit_msg:  String,
    cas:         Arc<CasStore>,
    db:          Arc<Database>,
) -> Result<Option<BranchHeadUpdate>, StorageError> {
    let commit = match db.get_commit(&head_commit).await? {
        Some(c) => c,
        None    => return Ok(None),
    };

    // Load the tree JSON blob
    let tree_bytes = cas.read_blob(&commit.tree_hash).await?;
    let mut tree: serde_json::Value = serde_json::from_slice(&tree_bytes)?;

    let tracks = match tree["tracks"].as_array_mut() {
        Some(t) => t,
        None    => return Ok(None),
    };

    // Patch any entries that reference the old hash
    let mut changed = false;
    for entry in tracks.iter_mut() {
        if entry["hash"].as_str() == Some(&old_hash) {
            entry["hash"] = serde_json::Value::String(new_hash.clone());
            changed = true;
        }
    }

    if !changed {
        return Ok(None);
    }

    // Write the new tree blob
    let new_tree_bytes = serde_json::to_vec(&tree)?;
    let new_tree_hash  = cas.write_blob(&new_tree_bytes).await?;

    // Build and store a new commit
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let commit_body = serde_json::json!({
        "tree_hash": &new_tree_hash,
        "parent":    &head_commit,
        "timestamp": timestamp,
        "device_id": "melomaniac-editor",
        "message":   &commit_msg,
    }).to_string();

    let new_commit_hash = cas.write_blob(commit_body.as_bytes()).await?;

    let record = CommitRecord {
        hash:      new_commit_hash.clone(),
        tree_hash: new_tree_hash,
        timestamp,
        device_id: "melomaniac-editor".to_string(),
        message:   Some(commit_msg),
    };
    db.insert_commit(&record, &[head_commit.as_str()]).await?;

    Ok(Some(BranchHeadUpdate { branch_id, new_commit_hash }))
}

// ── Bulk metadata edit ────────────────────────────────────────────────────────

/// Edit multiple library tracks in one operation.
///
/// All hash swaps are patched into each affected branch in a single pass and
/// a single commit is created per branch, keeping history clean regardless of
/// how many tracks are edited at once.
///
/// Returns a vec of `(old_hash, new_hash)` pairs for all tracks whose bytes
/// actually changed (unchanged tracks are omitted).
pub async fn edit_cas_tracks_bulk(
    edits: &[(String, AudioMetadata)],
    cas:   &Arc<CasStore>,
    db:    &Arc<Database>,
) -> Result<Vec<(String, String)>, StorageError> {
    // Phase 1 — rewrite each blob, update DB row.
    struct Mapping { old: String, new: String, title: String }
    let mut mappings: Vec<Mapping> = Vec::new();

    for (old_hash, metadata) in edits {
        let track = db.get_track(old_hash).await?
            .ok_or_else(|| StorageError::BlobNotFound(old_hash.clone()))?;
        let ext      = mime_to_ext(track.mime_type.as_deref().unwrap_or("audio/mpeg")).to_string();
        let original = cas.read_blob(old_hash).await?;
        let new_bytes = apply_metadata_to_bytes(original, ext, metadata.clone()).await?;
        let new_hash  = CasStore::hash(&new_bytes);
        if new_hash == *old_hash { continue; }

        cas.write_blob(&new_bytes).await?;
        db.update_track_hash_and_metadata(
            old_hash, &new_hash,
            metadata.title.as_deref().unwrap_or(&track.title),
            metadata.artist.as_deref().unwrap_or(&track.artist),
            metadata.album.as_deref().or(track.album.as_deref()),
        ).await?;

        let title = metadata.title.clone().unwrap_or_else(|| track.title.clone());
        mappings.push(Mapping { old: old_hash.clone(), new: new_hash, title });
    }

    if mappings.is_empty() {
        return Ok(vec![]);
    }

    // Phase 2 — patch every affected branch once with all hash swaps.
    let commit_msg = if mappings.len() == 1 {
        format!("Edit metadata: {}", mappings[0].title)
    } else {
        let bullets = mappings.iter().map(|m| format!("• {}", m.title)).collect::<Vec<_>>().join("\n");
        format!("Edit metadata: {} tracks\n{}", mappings.len(), bullets)
    };

    let pairs: Vec<(String, String)> = mappings.iter().map(|m| (m.old.clone(), m.new.clone())).collect();
    patch_trees_bulk_parallel(&pairs, &commit_msg, cas, db).await?;

    Ok(pairs)
}

async fn patch_trees_bulk_parallel(
    mappings:   &[(String, String)],
    commit_msg: &str,
    cas:        &Arc<CasStore>,
    db:         &Arc<Database>,
) -> Result<(), StorageError> {
    let branches = db.get_all_branches_with_heads().await?;

    let mut set = tokio::task::JoinSet::new();
    for (branch_id, head_commit) in branches {
        let mappings   = mappings.to_vec();
        let msg        = commit_msg.to_string();
        let cas        = Arc::clone(cas);
        let db         = Arc::clone(db);
        set.spawn(async move {
            patch_single_branch_bulk(branch_id, head_commit, mappings, msg, cas, db).await
        });
    }

    let mut updates: Vec<BranchHeadUpdate> = Vec::new();
    while let Some(result) = set.join_next().await {
        match result {
            Ok(Ok(Some(u))) => updates.push(u),
            Ok(Ok(None))    => {}
            Ok(Err(e))      => eprintln!("[editor] bulk branch patch error: {e}"),
            Err(e)          => eprintln!("[editor] bulk branch task error: {e}"),
        }
    }

    if !updates.is_empty() {
        let pairs: Vec<(String, String)> = updates
            .into_iter()
            .map(|u| (u.branch_id, u.new_commit_hash))
            .collect();
        db.batch_update_branch_heads(&pairs).await?;
    }

    Ok(())
}

async fn patch_single_branch_bulk(
    branch_id:  String,
    head_commit: String,
    mappings:   Vec<(String, String)>,
    commit_msg: String,
    cas:        Arc<CasStore>,
    db:         Arc<Database>,
) -> Result<Option<BranchHeadUpdate>, StorageError> {
    let commit = match db.get_commit(&head_commit).await? {
        Some(c) => c,
        None    => return Ok(None),
    };

    let tree_bytes = cas.read_blob(&commit.tree_hash).await?;
    let mut tree: serde_json::Value = serde_json::from_slice(&tree_bytes)?;

    let tracks = match tree["tracks"].as_array_mut() {
        Some(t) => t,
        None    => return Ok(None),
    };

    // Apply every hash mapping in a single pass.
    let mut changed = false;
    for entry in tracks.iter_mut() {
        if let Some(h) = entry["hash"].as_str() {
            if let Some((_, new)) = mappings.iter().find(|(old, _)| old == h) {
                entry["hash"] = serde_json::Value::String(new.clone());
                changed = true;
            }
        }
    }

    if !changed {
        return Ok(None);
    }

    let new_tree_bytes  = serde_json::to_vec(&tree)?;
    let new_tree_hash   = cas.write_blob(&new_tree_bytes).await?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let commit_body = serde_json::json!({
        "tree_hash": &new_tree_hash,
        "parent":    &head_commit,
        "timestamp": timestamp,
        "device_id": "melomaniac-editor",
        "message":   &commit_msg,
    }).to_string();

    let new_commit_hash = cas.write_blob(commit_body.as_bytes()).await?;

    let record = CommitRecord {
        hash:      new_commit_hash.clone(),
        tree_hash: new_tree_hash,
        timestamp,
        device_id: "melomaniac-editor".to_string(),
        message:   Some(commit_msg),
    };
    db.insert_commit(&record, &[head_commit.as_str()]).await?;

    Ok(Some(BranchHeadUpdate { branch_id, new_commit_hash }))
}

// ── Artwork changelog commits ─────────────────────────────────────────────────
//
// Artwork changes don't rewrite audio blobs, so track hashes stay the same and
// branch trees are unchanged.  We still create a commit on every branch that
// contains at least one affected track so the change appears in playlist history.

async fn commit_branches_for_artwork(
    affected_hashes: &[String],
    commit_msg:      &str,
    cas:             &Arc<CasStore>,
    db:              &Arc<Database>,
) -> Result<(), StorageError> {
    let branches = db.get_all_branches_with_heads().await?;

    let mut set = tokio::task::JoinSet::new();
    for (branch_id, head_commit) in branches {
        let affected = affected_hashes.to_vec();
        let msg      = commit_msg.to_string();
        let cas      = Arc::clone(cas);
        let db       = Arc::clone(db);
        set.spawn(async move {
            artwork_commit_single_branch(branch_id, head_commit, affected, msg, cas, db).await
        });
    }

    let mut updates: Vec<BranchHeadUpdate> = Vec::new();
    while let Some(result) = set.join_next().await {
        match result {
            Ok(Ok(Some(u))) => updates.push(u),
            Ok(Ok(None))    => {}
            Ok(Err(e))      => eprintln!("[editor] artwork commit error: {e}"),
            Err(e)          => eprintln!("[editor] artwork commit task error: {e}"),
        }
    }

    if !updates.is_empty() {
        let pairs: Vec<(String, String)> = updates
            .into_iter()
            .map(|u| (u.branch_id, u.new_commit_hash))
            .collect();
        db.batch_update_branch_heads(&pairs).await?;
    }

    Ok(())
}

async fn artwork_commit_single_branch(
    branch_id:       String,
    head_commit:     String,
    affected_hashes: Vec<String>,
    commit_msg:      String,
    cas:             Arc<CasStore>,
    db:              Arc<Database>,
) -> Result<Option<BranchHeadUpdate>, StorageError> {
    let commit = match db.get_commit(&head_commit).await? {
        Some(c) => c,
        None    => return Ok(None),
    };

    // Only commit if this branch actually contains one of the affected tracks
    let tree_bytes = cas.read_blob(&commit.tree_hash).await?;
    let tree: serde_json::Value = serde_json::from_slice(&tree_bytes)?;
    let tracks = match tree["tracks"].as_array() {
        Some(t) => t,
        None    => return Ok(None),
    };
    let in_branch = tracks.iter()
        .filter_map(|e| e["hash"].as_str())
        .any(|h| affected_hashes.iter().any(|a| a == h));
    if !in_branch {
        return Ok(None);
    }

    // Create a new commit pointing to the same tree (no track-order change)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let commit_body = serde_json::json!({
        "tree_hash": &commit.tree_hash,
        "parent":    &head_commit,
        "timestamp": timestamp,
        "device_id": "melomaniac-editor",
        "message":   &commit_msg,
    }).to_string();

    let new_commit_hash = cas.write_blob(commit_body.as_bytes()).await?;

    let record = CommitRecord {
        hash:      new_commit_hash.clone(),
        tree_hash: commit.tree_hash,
        timestamp,
        device_id: "melomaniac-editor".to_string(),
        message:   Some(commit_msg),
    };
    db.insert_commit(&record, &[head_commit.as_str()]).await?;

    Ok(Some(BranchHeadUpdate { branch_id, new_commit_hash }))
}

// ── Lofty sync helpers (always called inside spawn_blocking) ──────────────────

fn read_metadata_sync(path: &Path) -> Result<AudioMetadata, StorageError> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::ItemKey;

    let tagged = Probe::open(path)
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .guess_file_type()
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .read()
        .map_err(|e| StorageError::Metadata(e.to_string()))?;

    let duration_ms = tagged.properties().duration().as_millis() as u64;
    let format      = format!("{:?}", tagged.file_type());
    let file_size   = std::fs::metadata(path).ok().map(|m| m.len());

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let get = |key: &ItemKey| tag.and_then(|t| t.get_string(key)).map(str::to_string);

    let (track_number, track_total) = parse_nn_total(get(&ItemKey::TrackNumber).as_deref());
    let (disc_number,  disc_total)  = parse_nn_total(get(&ItemKey::DiscNumber).as_deref());

    Ok(AudioMetadata {
        title:        get(&ItemKey::TrackTitle),
        artist:       get(&ItemKey::TrackArtist),
        album:        get(&ItemKey::AlbumTitle),
        album_artist: get(&ItemKey::AlbumArtist),
        year:         get(&ItemKey::Year).and_then(|s| s.parse().ok()),
        track_number,
        track_total,
        disc_number,
        disc_total,
        genre:        get(&ItemKey::Genre),
        composer:     get(&ItemKey::Composer),
        comment:      get(&ItemKey::Comment),
        lyrics:       get(&ItemKey::Lyrics),
        bpm:          get(&ItemKey::Bpm).and_then(|s| s.parse().ok()),
        copyright:    get(&ItemKey::CopyrightMessage),
        duration_ms,
        format,
        file_size,
    })
}

fn apply_lofty_tags(path: &Path, metadata: &AudioMetadata) -> Result<(), StorageError> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::config::WriteOptions;

    let mut tagged = Probe::open(path)
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .guess_file_type()
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .read()
        .map_err(|e| StorageError::Metadata(e.to_string()))?;

    if tagged.primary_tag().is_none() {
        let tag_type = default_tag_type(tagged.file_type());
        tagged.insert_tag(lofty::tag::Tag::new(tag_type));
    }

    if let Some(tag) = tagged.primary_tag_mut() {
        apply_tag_fields(tag, metadata);
    }

    tagged.save_to_path(path, WriteOptions::default())
        .map_err(|e| StorageError::Metadata(e.to_string()))
}

fn apply_tag_fields(tag: &mut lofty::tag::Tag, m: &AudioMetadata) {
    use lofty::prelude::*;
    use lofty::tag::ItemKey;

    macro_rules! set_opt {
        ($key:expr, $val:expr) => {
            if let Some(ref v) = $val {
                tag.insert_text($key, v.clone());
            } else {
                tag.remove_key(&$key);
            }
        };
    }

    set_opt!(ItemKey::TrackTitle,       m.title);
    set_opt!(ItemKey::TrackArtist,      m.artist);
    set_opt!(ItemKey::AlbumTitle,       m.album);
    set_opt!(ItemKey::AlbumArtist,      m.album_artist);
    set_opt!(ItemKey::Genre,            m.genre);
    set_opt!(ItemKey::Composer,         m.composer);
    set_opt!(ItemKey::Comment,          m.comment);
    set_opt!(ItemKey::Lyrics,           m.lyrics);
    set_opt!(ItemKey::CopyrightMessage, m.copyright);

    if let Some(y) = m.year {
        tag.insert_text(ItemKey::Year, y.to_string());
    }
    if let Some(n) = m.track_number {
        let s = match m.track_total {
            Some(t) => format!("{n}/{t}"),
            None    => n.to_string(),
        };
        tag.insert_text(ItemKey::TrackNumber, s);
    }
    if let Some(n) = m.disc_number {
        let s = match m.disc_total {
            Some(t) => format!("{n}/{t}"),
            None    => n.to_string(),
        };
        tag.insert_text(ItemKey::DiscNumber, s);
    }
    if let Some(b) = m.bpm {
        tag.insert_text(ItemKey::Bpm, b.to_string());
    }
}

fn scan_directory_sync(path: &Path) -> Result<Vec<FileEntry>, StorageError> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::tag::ItemKey;

    const AUDIO_EXTS: &[&str] = &[
        "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "alac", "aiff", "wma",
    ];

    let mut entries = Vec::new();

    for entry in std::fs::read_dir(path)?.flatten() {
        let p = entry.path();
        if !p.is_file() { continue; }

        let ext = p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());

        match ext.as_deref() {
            Some(e) if AUDIO_EXTS.contains(&e) => {}
            _ => continue,
        }

        let size_bytes = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
        let filename   = p.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Best-effort metadata — skip unreadable files silently
        let (title, artist, album, duration_ms, format) = Probe::open(&p)
            .ok()
            .and_then(|pr| pr.guess_file_type().ok())
            .and_then(|pr| pr.read().ok())
            .map(|tagged| {
                let dur = tagged.properties().duration().as_millis() as u64;
                let fmt = format!("{:?}", tagged.file_type());
                let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
                let get = |key: &ItemKey| tag.and_then(|t| t.get_string(key)).map(str::to_string);
                (
                    get(&ItemKey::TrackTitle),
                    get(&ItemKey::TrackArtist),
                    get(&ItemKey::AlbumTitle),
                    dur,
                    fmt,
                )
            })
            .unwrap_or_else(|| {
                let fmt = ext.unwrap_or_default().to_uppercase();
                (None, None, None, 0, fmt)
            });

        entries.push(FileEntry {
            path: p.display().to_string(),
            filename,
            format,
            size_bytes,
            title,
            artist,
            album,
            duration_ms,
        });
    }

    entries.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(entries)
}

// ── Tag bytes via temp file ───────────────────────────────────────────────────

/// Write `bytes` to a uniquely-named temp file, apply lofty tags, read back.
async fn apply_metadata_to_bytes(
    bytes:    Vec<u8>,
    ext:      String,
    metadata: AudioMetadata,
) -> Result<Vec<u8>, StorageError> {
    let tmp = std::env::temp_dir()
        .join(format!("melomaniac_edit_{}.{}", uuid::Uuid::new_v4(), ext));

    tokio::fs::write(&tmp, &bytes).await?;

    let tmp_clone = tmp.clone();
    tokio::task::spawn_blocking(move || apply_lofty_tags(&tmp_clone, &metadata))
        .await
        .map_err(|e| StorageError::Metadata(e.to_string()))??;

    let new_bytes = tokio::fs::read(&tmp).await?;
    tokio::fs::remove_file(&tmp).await.ok();
    Ok(new_bytes)
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/// Parse "N" or "N/Total" into (number, optional_total).
fn parse_nn_total(s: Option<&str>) -> (Option<u32>, Option<u32>) {
    let Some(s) = s else { return (None, None) };
    let mut parts = s.splitn(2, '/');
    let num   = parts.next().and_then(|n| n.trim().parse().ok());
    let total = parts.next().and_then(|n| n.trim().parse().ok());
    (num, total)
}

fn default_tag_type(file_type: lofty::file::FileType) -> lofty::tag::TagType {
    use lofty::file::FileType;
    use lofty::tag::TagType;
    match file_type {
        FileType::Mpeg                     => TagType::Id3v2,
        FileType::Flac                     => TagType::VorbisComments,
        FileType::Vorbis | FileType::Opus  => TagType::VorbisComments,
        FileType::Wav                      => TagType::Id3v2,
        FileType::Mp4                      => TagType::Mp4Ilst,
        FileType::Aiff                     => TagType::Id3v2,
        FileType::Ape                      => TagType::Ape,
        _                                  => TagType::Id3v2,
    }
}

fn embed_picture_in_file(path: &Path, image_bytes: &[u8]) -> Result<(), StorageError> {
    use lofty::prelude::*;
    use lofty::probe::Probe;
    use lofty::config::WriteOptions;
    use lofty::picture::{Picture, PictureType, MimeType};

    let mut tagged = Probe::open(path)
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .guess_file_type()
        .map_err(|e| StorageError::Metadata(e.to_string()))?
        .read()
        .map_err(|e| StorageError::Metadata(e.to_string()))?;

    if tagged.primary_tag().is_none() {
        let tag_type = default_tag_type(tagged.file_type());
        tagged.insert_tag(lofty::tag::Tag::new(tag_type));
    }

    let mime = if image_bytes.starts_with(b"\x89PNG") { MimeType::Png } else { MimeType::Jpeg };
    let picture = Picture::new_unchecked(PictureType::CoverFront, Some(mime), None, image_bytes.to_vec());

    if let Some(tag) = tagged.primary_tag_mut() {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(picture);
    }

    tagged.save_to_path(path, WriteOptions::default())
        .map_err(|e| StorageError::Metadata(e.to_string()))
}

fn mime_to_ext(mime: &str) -> &'static str {
    match mime {
        "audio/mpeg" | "audio/mp3"                    => "mp3",
        "audio/flac" | "audio/x-flac"                 => "flac",
        "audio/ogg"  | "audio/vorbis"                 => "ogg",
        "audio/wav"  | "audio/x-wav"                  => "wav",
        "audio/mp4"  | "audio/m4a" | "audio/x-m4a"   => "m4a",
        "audio/aac"                                   => "aac",
        "audio/opus"                                  => "opus",
        "audio/webm" | "video/webm"                   => "webm",
        _                                             => "mp3",
    }
}
