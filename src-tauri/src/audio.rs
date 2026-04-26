use std::sync::Arc;

use melomaniac_audio::{AudioBridge, AudioSource, TrackMetadata};
use tauri::State;

/// Holds the active bridge implementation. Stored in Tauri managed state.
/// `Arc<dyn AudioBridge>` is `Send + Sync` because `AudioBridge: Send + Sync`.
pub struct AudioState {
    pub bridge: Arc<dyn AudioBridge>,
}

// ── Commands ──────────────────────────────────────────────────────────────────
//
// All commands convert AudioError → String at the boundary so Tauri can
// serialise the Result automatically. Richer error propagation can be added
// later by deriving Serialize on AudioError.
//
// TODO: audio_load currently accepts a raw file path for testability.
//       Replace `path` with `hash: String` and resolve via CAS once the
//       storage layer is implemented (see context/PLAN.md — CAS Model).

#[tauri::command]
pub fn audio_load(
    path: String,
    metadata: TrackMetadata,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    let source = AudioSource::File(path.into());
    state.bridge.load(&source, metadata).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_play(state: State<'_, AudioState>) -> Result<(), String> {
    state.bridge.play().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_pause(state: State<'_, AudioState>) -> Result<(), String> {
    state.bridge.pause().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_stop(state: State<'_, AudioState>) -> Result<(), String> {
    state.bridge.stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_seek(position_ms: u64, state: State<'_, AudioState>) -> Result<(), String> {
    state.bridge.seek(position_ms).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_set_volume(volume: f32, state: State<'_, AudioState>) -> Result<(), String> {
    state.bridge.set_volume(volume).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_position(state: State<'_, AudioState>) -> Result<u64, String> {
    state.bridge.position_ms().map_err(|e| e.to_string())
}
