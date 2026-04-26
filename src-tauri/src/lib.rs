mod audio;

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

            #[cfg(desktop)]
            let bridge = {
                use melomaniac_audio::desktop::DesktopBridge;
                Arc::new(
                    DesktopBridge::new(event_tx)
                        .expect("failed to open audio output device"),
                ) as Arc<dyn melomaniac_audio::AudioBridge>
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::audio_load,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_stop,
            audio::audio_seek,
            audio::audio_set_volume,
            audio::audio_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
