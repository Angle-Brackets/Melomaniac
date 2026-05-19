use std::sync::Arc;

use melomaniac_sync::{KnownDevice, PeerInfo, QrPayload, SyncBridge, SyncReport};
use tauri::State;

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
