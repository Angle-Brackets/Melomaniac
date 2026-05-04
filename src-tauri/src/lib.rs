mod audio;
mod storage;

use std::sync::Arc;

use audio::AudioState;
use melomaniac_audio::AudioEvent;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let (event_tx, event_rx) = std::sync::mpsc::channel::<AudioEvent>();

            let bridge = {
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                {
                    use melomaniac_audio::desktop::DesktopBridge;
                    Arc::new(
                        DesktopBridge::new(event_tx)
                            .expect("failed to open audio output device"),
                    ) as Arc<dyn melomaniac_audio::AudioBridge>
                }

                #[cfg(target_os = "ios")]
                {
                    use melomaniac_audio::ios::IosBridge;
                    Arc::new(IosBridge::new(event_tx)) as Arc<dyn melomaniac_audio::AudioBridge>
                }

                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux", target_os = "ios")))]
                {
                    panic!("Audio bridge not implemented for this platform");
                }
            };

            // Forward AudioEvents from the bridge to the frontend via Tauri events.
            // A dedicated OS thread is used because mpsc::Receiver::recv() is blocking
            // and must not stall the tokio runtime.
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("audio-events".into())
                .spawn(move || {
                    for event in event_rx {
                        handle.emit("audio://event", &event).ok();
                    }
                })
                .expect("failed to spawn audio event thread");

            app.manage(AudioState { bridge });

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let storage_state = tauri::async_runtime::block_on(storage::init_storage(app_data_dir))
                .expect("failed to initialise storage");

            // In debug builds, pre-ingest the bundled test track so the library
            // is never empty during development.
            #[cfg(debug_assertions)]
            {
                const TEST_MP3: &[u8] = include_bytes!("../../tests/audio/test.mp3");
                let cas = Arc::clone(&storage_state.cas);
                let db  = Arc::clone(&storage_state.db);
                tauri::async_runtime::block_on(
                    melomaniac_storage::ingest::ingest_bytes(TEST_MP3, "test", &cas, &db)
                ).ok(); // idempotent — silently skip if already present
            }

            app.manage(storage_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::debug_play_test_track,
            audio::audio_load,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_stop,
            audio::audio_seek,
            audio::audio_set_volume,
            audio::audio_position,
            audio::track_play,
            storage::library_get_all,
            storage::library_set_favorite,
            storage::track_ingest_files,
            storage::track_get_artwork,
            storage::playlist_get_all,
            storage::playlist_create,
            storage::playlist_fork,
            storage::branch_create,
            storage::branch_commit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
