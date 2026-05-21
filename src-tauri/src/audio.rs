use std::sync::Arc;

use melomaniac_audio::{AudioBridge, AudioSource, TrackMetadata};
use tauri::State;

// ── Debug autoplay ────────────────────────────────────────────────────────────

/// Embeds `tests/audio/test.mp3` at compile time, writes it into the CAS,
/// and immediately loads + plays it. Only functional in debug builds; returns
/// an error in release so the handler can still be registered unconditionally.
#[tauri::command]
pub async fn debug_play_test_track(
    audio: State<'_, AudioState>,
    storage: State<'_, crate::storage::StorageState>,
) -> Result<(), String> {
    play_impl(audio, storage).await
}

#[cfg(debug_assertions)]
async fn play_impl(
    audio: State<'_, AudioState>,
    storage: State<'_, crate::storage::StorageState>,
) -> Result<(), String> {
    const TEST_MP3: &[u8] = include_bytes!("../../tests/audio/test.mp3");

    let hash = storage
        .cas
        .write_blob(TEST_MP3)
        .await
        .map_err(|e| e.to_string())?;

    let path = storage.cas.blob_path(&hash);

    let meta = TrackMetadata {
        title: "Test Track".into(),
        artist: "Test Artist".into(),
        album: Some("Test Album".into()),
        artwork_path: None,
        duration_ms: Some(144_000), // 2.2 MB @ 128 kbps ≈ 2:24
        mime_type: Some("audio/mpeg".into()),
    };

    let source = AudioSource::File(path);
    let bridge = Arc::clone(&audio.bridge);
    tauri::async_runtime::spawn_blocking(move || {
        bridge.load(&source, meta).map_err(|e| e.to_string())?;
        bridge.play().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(debug_assertions))]
async fn play_impl(
    _audio: State<'_, AudioState>,
    _storage: State<'_, crate::storage::StorageState>,
) -> Result<(), String> {
    Err("debug commands are not available in release builds".into())
}

/// Holds the active bridge implementation. Stored in Tauri managed state.
/// `Arc<dyn AudioBridge>` is `Send + Sync` because `AudioBridge: Send + Sync`.
pub struct AudioState {
    pub bridge: Arc<dyn AudioBridge>,
}

// ── Unified play-by-hash command ──────────────────────────────────────────────

/// Resolve `hash` → CAS path + DB metadata, then load and play in one call.
/// This is the primary playback entry-point for the frontend; `audio_load` is
/// kept as an internal detail used only by debug commands.
#[tauri::command]
pub async fn track_play(
    hash: String,
    storage: State<'_, crate::storage::StorageState>,
    audio: State<'_, AudioState>,
) -> Result<(), String> {
    let record = storage
        .db
        .get_track(&hash)
        .await
        .map_err(|e| e.to_string())?;

    let path = storage.cas.blob_path(&hash);

    // If the track isn't in the DB yet (e.g. mid-sync), play the blob with
    // whatever metadata we have — audio still works, lock-screen will just
    // show an empty title until the next sync run fills the row.
    let meta = match record {
        Some(r) => TrackMetadata {
            title:       r.title,
            artist:      r.artist,
            album:       r.album,
            artwork_path: r.artwork_hash.as_deref().map(|h| storage.cas.blob_path(h)),
            duration_ms: Some(r.duration_ms as u64),
            mime_type:   r.mime_type,
        },
        None => TrackMetadata {
            title:       hash[..hash.len().min(8)].to_string(),
            artist:      String::new(),
            album:       None,
            artwork_path: None,
            duration_ms: None,
            mime_type:   None,
        },
    };

    let source = AudioSource::File(path);
    let bridge = Arc::clone(&audio.bridge);
    tauri::async_runtime::spawn_blocking(move || {
        bridge.load(&source, meta).map_err(|e| e.to_string())?;
        bridge.play().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
