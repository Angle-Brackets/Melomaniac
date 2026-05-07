mod audio;
mod downloader;
mod editor;
mod network;
mod stats;
mod storage;

use std::sync::Arc;

use audio::AudioState;
use downloader::DownloadManager;
use melomaniac_audio::AudioEvent;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (event_tx, event_rx) = std::sync::mpsc::channel::<AudioEvent>();

            let bridge = {
                #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                {
                    use melomaniac_audio::desktop::DesktopBridge;
                    Arc::new(
                        DesktopBridge::new(event_tx).expect("failed to open audio output device"),
                    ) as Arc<dyn melomaniac_audio::AudioBridge>
                }

                #[cfg(target_os = "ios")]
                {
                    use melomaniac_audio::ios::IosBridge;
                    Arc::new(IosBridge::new(event_tx)) as Arc<dyn melomaniac_audio::AudioBridge>
                }

                #[cfg(not(any(
                    target_os = "macos",
                    target_os = "windows",
                    target_os = "linux",
                    target_os = "ios"
                )))]
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

            // In debug builds, ingest every audio file in tests/audio/ so the
            // library is never empty during development.
            #[cfg(debug_assertions)]
            {
                let audio_exts = ["mp3", "flac", "ogg", "wav", "m4a", "aac"];
                let test_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../tests/audio");
                if let Ok(entries) = std::fs::read_dir(&test_dir) {
                    let cas = Arc::clone(&storage_state.cas);
                    let db  = Arc::clone(&storage_state.db);
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let ext  = path.extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_ascii_lowercase());
                        if ext.as_deref().map(|e| audio_exts.contains(&e)).unwrap_or(false) {
                            tauri::async_runtime::block_on(
                                melomaniac_storage::ingest::ingest_file(&path, &cas, &db),
                            )
                            .ok();
                        }
                    }
                }
            }

            app.manage(storage_state);
            app.manage(Arc::new(DownloadManager::new()));
            app.manage(stats::SystemState(std::sync::Mutex::new(
                sysinfo::System::new(),
            )));

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
            storage::library_import_folder,
            storage::library_remove_track,
            storage::track_ingest_files,
            storage::track_get_artwork,
            storage::playlist_get_all,
            storage::playlist_create,
            storage::playlist_fork,
            storage::branch_create,
            storage::branch_commit,
            storage::branch_get_history,
            storage::get_recent_commits,
            storage::branch_append_tracks,
            editor::file_read_metadata,
            editor::file_write_metadata,
            editor::file_scan_directory,
            editor::library_read_metadata,
            editor::library_edit_track,
            editor::library_set_artwork,
            editor::library_set_artwork_for_tracks,
            editor::library_replace_artwork,
            editor::file_set_artwork,
            storage::get_artwork_library,
            storage::get_artwork_blob,
            storage::library_get_stray_tracks,
            stats::get_system_stats,
            network::fetch_image_url,
            downloader::download_enqueue,
            downloader::download_queue,
            downloader::download_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
