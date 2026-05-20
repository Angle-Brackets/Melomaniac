use std::sync::Arc;

use melomaniac_storage::{CommitRecord, TreeBlob};
use melomaniac_sync::{ConflictKind, KnownDevice, PeerInfo, QrPayload, SyncBridge, SyncReport};
use tauri::State;

use crate::storage::StorageState;

pub struct SyncState {
    pub bridge: Arc<dyn SyncBridge>,
}

#[tauri::command]
pub async fn sync_get_peers(state: State<'_, SyncState>) -> Result<Vec<PeerInfo>, String> {
    Ok(state.bridge.peers())
}

#[tauri::command]
pub async fn sync_open_discovery_window(state: State<'_, SyncState>) -> Result<(), String> {
    state.bridge.open_discovery_window(300);
    Ok(())
}

#[tauri::command]
pub async fn sync_close_discovery_window(state: State<'_, SyncState>) -> Result<(), String> {
    state.bridge.close_discovery_window();
    Ok(())
}

#[tauri::command]
pub async fn sync_is_discovery_open(state: State<'_, SyncState>) -> Result<bool, String> {
    Ok(state.bridge.is_discovery_open())
}

#[tauri::command]
pub async fn sync_generate_qr_payload(state: State<'_, SyncState>) -> Result<QrPayload, String> {
    state.bridge.generate_qr_payload().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_accept_qr_pairing(
    payload: QrPayload,
    state: State<'_, SyncState>,
) -> Result<(), String> {
    state
        .bridge
        .accept_qr_pairing(payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_known_devices(state: State<'_, SyncState>) -> Result<Vec<KnownDevice>, String> {
    Ok(state.bridge.known_devices())
}

#[tauri::command]
pub async fn sync_remove_device(
    public_key_b64: String,
    state: State<'_, SyncState>,
) -> Result<(), String> {
    state
        .bridge
        .remove_device(&public_key_b64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_playlist(
    playlist_id: String,
    state: State<'_, SyncState>,
) -> Result<SyncReport, String> {
    state
        .bridge
        .sync_playlist(&playlist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_with_peer(
    public_key_b64: String,
    state: State<'_, SyncState>,
) -> Result<SyncReport, String> {
    state
        .bridge
        .sync_with_peer(&public_key_b64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_get_fingerprint(state: State<'_, SyncState>) -> Result<String, String> {
    Ok(state.bridge.fingerprint())
}

/// Choice the user made for one conflict chunk.
#[derive(Debug, serde::Deserialize)]
pub(crate) struct ConflictResolution {
    conflict_id: String,
    choice: String, // "KeepOurs" | "KeepTheirs" | "KeepBoth" | "Delete"
}

#[tauri::command]
pub async fn resolve_merge_conflict(
    playlist_id: String,
    resolutions: Vec<ConflictResolution>,
    sync_state: State<'_, SyncState>,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    let pending = sync_state
        .bridge
        .pending_merge(&playlist_id)
        .ok_or_else(|| format!("no pending merge for playlist {playlist_id}"))?;

    let db  = &storage.db;
    let cas = &storage.cas;

    let mut merged: TreeBlob = db
        .read_tree_for_commit(cas, &pending.local_head)
        .await
        .map_err(|e| e.to_string())?;

    let their_tree: TreeBlob = db
        .read_tree_for_commit(cas, &pending.peer_head)
        .await
        .map_err(|e| e.to_string())?;

    for resolution in &resolutions {
        let chunk = pending
            .conflicts
            .iter()
            .find(|c| c.id == resolution.conflict_id)
            .ok_or_else(|| format!("unknown conflict id: {}", resolution.conflict_id))?;

        match chunk.kind {
            ConflictKind::MetadataEdit => {
                if resolution.choice == "KeepTheirs" {
                    if let Some(name) = chunk.theirs.as_str() {
                        merged.meta.name = name.to_string();
                    }
                }
            }

            ConflictKind::TrackOrder => {
                if resolution.choice == "KeepTheirs" {
                    if let Some(order) = chunk.theirs.as_array() {
                        let hashes: Vec<String> = order
                            .iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect();
                        merged.tracks.sort_by_key(|t| {
                            hashes.iter().position(|h| h == &t.hash).unwrap_or(usize::MAX)
                        });
                    }
                }
            }

            ConflictKind::TrackDeletedVsModified => {
                let track_hash = chunk
                    .context
                    .get("hash")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "TrackDeletedVsModified conflict missing hash in context".to_string())?;

                match resolution.choice.as_str() {
                    "Delete" => {
                        merged.tracks.retain(|t| t.hash != track_hash);
                    }
                    "KeepTheirs" => {
                        // Re-add from their tree if we had deleted it.
                        if !merged.tracks.iter().any(|t| t.hash == track_hash) {
                            if let Some(t) = their_tree.tracks.iter().find(|t| t.hash == track_hash) {
                                merged.tracks.push(t.clone());
                            }
                        }
                        // Apply their AB points if they modified it.
                        if let Some(their_entry) = their_tree.tracks.iter().find(|t| t.hash == track_hash) {
                            if let Some(ours) = merged.tracks.iter_mut().find(|t| t.hash == track_hash) {
                                ours.ab_start_ms = their_entry.ab_start_ms;
                                ours.ab_end_ms   = their_entry.ab_end_ms;
                            }
                        }
                    }
                    _ => {} // KeepOurs: no change needed
                }
            }

            ConflictKind::AbLoopPoints => {
                if resolution.choice == "KeepTheirs" {
                    let hash = chunk.theirs.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                    let ab_start = chunk.theirs.get("ab_start_ms").and_then(|v| v.as_u64());
                    let ab_end   = chunk.theirs.get("ab_end_ms").and_then(|v| v.as_u64());
                    if let Some(t) = merged.tracks.iter_mut().find(|t| t.hash == hash) {
                        t.ab_start_ms = ab_start;
                        t.ab_end_ms   = ab_end;
                    }
                }
            }

            ConflictKind::BranchNameCollision => {
                // Branch renames require separate branch-management logic; skip for Phase 1.
            }
        }
    }

    // Write the resolved tree and create a merge commit.
    let json = merged.to_json().map_err(|e| e.to_string())?;
    let tree_hash = cas.write_blob(json.as_bytes()).await.map_err(|e| e.to_string())?;

    let merge_commit = CommitRecord {
        hash:      uuid::Uuid::new_v4().to_string(),
        tree_hash,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64,
        device_id: sync_state.bridge.fingerprint(),
        message:   Some("merge".into()),
    };

    db.insert_commit(&merge_commit, &[&pending.local_head, &pending.peer_head])
        .await
        .map_err(|e| e.to_string())?;

    db.update_branch_head(&playlist_id, &pending.branch_name, &merge_commit.hash)
        .await
        .map_err(|e| e.to_string())?;

    sync_state.bridge.clear_pending_merge(&playlist_id);

    Ok(())
}
