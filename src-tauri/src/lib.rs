mod audio;
mod discord;
mod downloader;
mod editor;
mod network;
mod stats;
mod storage;
mod sync;

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

            let app_data_dir = {
                let base = app.path().app_data_dir().expect("failed to resolve app data dir");
                // Debug builds use an isolated subdirectory so manual testing
                // never pollutes the real library or playlist history.
                #[cfg(debug_assertions)] { base.join("dev") }
                #[cfg(not(debug_assertions))] { base }
            };

            let storage_state = tauri::async_runtime::block_on(storage::init_storage(app_data_dir))
                .expect("failed to initialise storage");

            // ── Debug-only dev fixtures ────────────────────────────────────────
            // Everything below runs only in `cargo tauri dev` / debug builds.
            // All data lands in the isolated `dev/` subdirectory of the app data
            // dir (see StorageState init above), so it never touches the real
            // production library or playlist history.
            #[cfg(debug_assertions)]
            {
                let audio_exts = ["mp3", "flac", "ogg", "wav", "m4a", "aac"];

                // Desktop dev: full test library. Installed debug builds (e.g. iOS
                // sideload): fall back to the small bundled dev-seeds/ folder.
                let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../tests/audio");
                let test_dir = if dev_path.exists() {
                    dev_path
                } else {
                    app.path().resource_dir()
                        .expect("resource dir")
                        .join("dev-seeds")
                };

                // Ingest every audio file in tests/audio/ into the dev library so
                // the library view is never empty during UI development.
                let mut dev_hashes: Vec<String> = Vec::new();
                if let Ok(entries) = std::fs::read_dir(&test_dir) {
                    let cas = Arc::clone(&storage_state.cas);
                    let db  = Arc::clone(&storage_state.db);
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let ext  = path.extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_ascii_lowercase());
                        if ext.as_deref().map(|e| audio_exts.contains(&e)).unwrap_or(false) {
                            if let Ok(record) = tauri::async_runtime::block_on(
                                melomaniac_storage::ingest::ingest_file(&path, &cas, &db),
                            ) {
                                dev_hashes.push(record.hash);
                            }
                        }
                    }
                }

                // Recreate the "DevelopmentOnly" playlist fresh on each launch so the
                // carousel and playback have a real playlist to exercise without
                // accumulating stale commit history.  The playlist is destroyed and
                // rebuilt here — it is purely a UI test fixture and is never shown in
                // production builds.
                if !dev_hashes.is_empty() {
                    tauri::async_runtime::block_on(
                        storage::dev_seed_dev_playlist(&storage_state, &dev_hashes)
                    ).ok();
                }
            }

            app.manage(storage_state);

            {
                use melomaniac_sync::NodeIdentity;
                use melomaniac_sync::SyncBridge;

                let sync_data_dir = app
                    .path()
                    .app_data_dir()
                    .expect("failed to resolve app data dir");

                let identity = NodeIdentity::load_or_create(&sync_data_dir)
                    .expect("failed to load or create node identity");

                let sync_bridge: Arc<dyn SyncBridge> = {
                    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
                    {
                        use melomaniac_sync::desktop::DesktopSyncBridge;
                        let b = DesktopSyncBridge::new(identity, sync_data_dir)
                            .expect("failed to create desktop sync bridge");
                        let ss = app.state::<crate::storage::StorageState>();
                        b.set_storage(Arc::clone(&ss.db), Arc::clone(&ss.cas));
                        b.start_discovery().ok();
                        Arc::new(b) as Arc<dyn SyncBridge>
                    }

                    #[cfg(target_os = "ios")]
                    {
                        use melomaniac_sync::ios::IosSyncBridge;
                        let b = IosSyncBridge::new(identity, sync_data_dir)
                            .expect("failed to create iOS sync bridge");
                        b.start_discovery().ok();
                        Arc::new(b) as Arc<dyn SyncBridge>
                    }

                    #[cfg(not(any(
                        target_os = "macos",
                        target_os = "windows",
                        target_os = "linux",
                        target_os = "ios"
                    )))]
                    {
                        panic!("Sync bridge not implemented for this platform");
                    }
                };

                app.manage(sync::SyncState { bridge: sync_bridge });
            }

            app.manage(Arc::new(DownloadManager::new()));
            app.manage(discord::DiscordState::new());
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
            storage::get_artwork_blob_bytes,
            storage::library_get_stray_tracks,
            stats::get_system_stats,
            network::fetch_image_url,
            downloader::download_enqueue,
            downloader::download_queue,
            downloader::download_cancel,
            discord::discord_apply_settings,
            discord::discord_set_activity,
            discord::discord_clear_activity,
            storage::playlist_get_tracks,
            storage::playlist_set_ab_loop,
            storage::playlist_remove_track,
            storage::playlist_reorder_tracks,
            storage::playlist_rename,
            storage::playlist_set_description,
            storage::playlist_get_meta,
            storage::playlist_set_artwork,
            storage::playlist_get_artwork,
            storage::playlist_delete,
            storage::branch_delete,
            storage::branch_rename,
            storage::branch_revert_to,
            storage::branch_merge,
            storage::playlist_get_graph,
            storage::get_commit_author,
            storage::set_commit_author,
            storage::library_get_storage_bytes,
            #[cfg(debug_assertions)]
            storage::dev_reset_playlists,
            sync::sync_get_peers,
            sync::sync_open_discovery_window,
            sync::sync_close_discovery_window,
            sync::sync_is_discovery_open,
            sync::sync_generate_qr_payload,
            sync::sync_accept_qr_pairing,
            sync::sync_known_devices,
            sync::sync_remove_device,
            sync::sync_playlist,
            sync::sync_with_peer,
            sync::sync_get_fingerprint,
            sync::resolve_merge_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
