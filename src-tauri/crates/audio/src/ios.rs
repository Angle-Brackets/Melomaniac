use crate::{AudioBridge, AudioError, AudioEvent, AudioSource, TrackMetadata};
use std::ffi::CString;
use std::os::raw::c_char;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, OnceLock};

// ── Swift FFI ─────────────────────────────────────────────────────────────────

#[link(name = "MelomaniacPlayer")]
unsafe extern "C" {
    fn melo_configure_session() -> bool;
    fn melo_load(path: *const c_char, mime_hint: *const c_char) -> bool;
    fn melo_play() -> bool;
    fn melo_pause();
    fn melo_stop();
    fn melo_seek(position_ms: u64);
    fn melo_set_volume(volume: f32);
    fn melo_position_ms() -> u64;
    #[allow(dead_code)]
    fn melo_duration_ms() -> u64;
    fn melo_is_finished() -> bool;
    fn melo_update_now_playing(
        title: *const c_char,
        artist: *const c_char,
        album: *const c_char,
        position_secs: f32,
    );
    fn melo_set_artwork_path(path: *const c_char);
    fn melo_register_remote_commands(callback: extern "C" fn(i32, f64));
    fn melo_set_like_state(active: bool);
    fn melo_set_shuffle_state(mode: i32);
    fn melo_set_privacy_mode(enabled: bool);
}

// ── Remote command routing ────────────────────────────────────────────────────
//
// C function pointers cannot capture closures. A process-global OnceLock
// routes Swift callbacks into the IosBridge event channel.

static REMOTE_CMD_TX: OnceLock<Sender<AudioEvent>> = OnceLock::new();

extern "C" fn remote_cmd_callback(code: i32, position_secs: f64) {
    let event = match code {
        0 => AudioEvent::RemotePlay,
        1 => AudioEvent::RemotePause,
        2 => AudioEvent::RemoteNextTrack,
        3 => AudioEvent::RemotePreviousTrack,
        4 => AudioEvent::RemoteTogglePlayPause,
        5 => AudioEvent::RemoteSeek((position_secs * 1000.0) as u64),
        6 => AudioEvent::RemoteLike,
        7 => AudioEvent::RemoteShuffleChange(position_secs as u8),
        _ => return,
    };
    if let Some(tx) = REMOTE_CMD_TX.get() {
        let _ = tx.send(event);
    }
}

// ── IosBridge ─────────────────────────────────────────────────────────────────

pub struct IosBridge {
    position_ms:  Arc<AtomicU64>,
    current_meta: Arc<Mutex<Option<TrackMetadata>>>,
}

impl IosBridge {
    pub fn new(event_tx: Sender<AudioEvent>) -> Self {
        unsafe { melo_configure_session() };

        // Register the remote-command channel exactly once per process.
        REMOTE_CMD_TX.get_or_init(|| {
            unsafe { melo_register_remote_commands(remote_cmd_callback) };
            event_tx.clone()
        });

        let position_ms  = Arc::new(AtomicU64::new(0));
        let current_meta = Arc::new(Mutex::new(None::<TrackMetadata>));

        // Monitoring thread: polls Swift state every 250ms (matches desktop).
        {
            let pos_arc  = Arc::clone(&position_ms);
            let meta_arc = Arc::clone(&current_meta);
            let tx       = event_tx.clone();

            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(250));

                    let pos = unsafe { melo_position_ms() };
                    pos_arc.store(pos, Ordering::Relaxed);

                    if tx.send(AudioEvent::PositionChanged(pos)).is_err() {
                        break; // channel closed — app shutting down
                    }

                    if unsafe { melo_is_finished() } {
                        if tx.send(AudioEvent::TrackEnded).is_err() {
                            break;
                        }
                    }

                    // Keep MPNowPlayingInfoCenter position in sync.
                    if let Ok(guard) = meta_arc.lock() {
                        if let Some(ref meta) = *guard {
                            push_now_playing(meta, pos as f32 / 1000.0);
                        }
                    }
                }
            });
        }

        Self { position_ms, current_meta }
    }
}

impl AudioBridge for IosBridge {
    fn load(&self, source: &AudioSource, metadata: TrackMetadata) -> Result<(), AudioError> {
        let path = match source {
            AudioSource::File(p) => p,
            AudioSource::Stream(_, impossible) => match *impossible {},
        };

        let path_str = path
            .to_str()
            .ok_or_else(|| AudioError::SourceNotFound(path.display().to_string()))?;

        let c_path = CString::new(path_str)
            .map_err(|_| AudioError::SourceNotFound(path_str.to_string()))?;

        let c_mime: Option<CString> = metadata
            .mime_type
            .as_deref()
            .and_then(|s| CString::new(s).ok());
        let mime_ptr = c_mime
            .as_ref()
            .map(|c| c.as_ptr())
            .unwrap_or(std::ptr::null());

        let ok = unsafe { melo_load(c_path.as_ptr(), mime_ptr) };
        if !ok {
            return Err(AudioError::SourceNotFound(path_str.to_string()));
        }

        self.position_ms.store(0, Ordering::Relaxed);

        // Emit initial now-playing info (position 0).
        push_now_playing(&metadata, 0.0);

        // Push artwork so the lock screen and Dynamic Island show cover art.
        let art_ptr = metadata.artwork_path.as_ref()
            .and_then(|p| p.to_str())
            .and_then(|s| std::ffi::CString::new(s).ok());
        unsafe {
            melo_set_artwork_path(
                art_ptr.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null()),
            );
        }

        // Store for the monitoring thread.
        if let Ok(mut guard) = self.current_meta.lock() {
            *guard = Some(metadata);
        }

        Ok(())
    }

    fn play(&self) -> Result<(), AudioError> {
        if unsafe { melo_play() } {
            Ok(())
        } else {
            Err(AudioError::NotLoaded)
        }
    }

    fn pause(&self) -> Result<(), AudioError> {
        unsafe { melo_pause() };
        Ok(())
    }

    fn stop(&self) -> Result<(), AudioError> {
        unsafe { melo_stop() };
        self.position_ms.store(0, Ordering::Relaxed);
        if let Ok(mut guard) = self.current_meta.lock() {
            *guard = None;
        }
        Ok(())
    }

    fn seek(&self, position_ms: u64) -> Result<(), AudioError> {
        unsafe { melo_seek(position_ms) };
        self.position_ms.store(position_ms, Ordering::Relaxed);
        Ok(())
    }

    fn set_volume(&self, volume: f32) -> Result<(), AudioError> {
        unsafe { melo_set_volume(volume) };
        Ok(())
    }

    fn position_ms(&self) -> Result<u64, AudioError> {
        Ok(self.position_ms.load(Ordering::Relaxed))
    }

    fn set_like_active(&self, active: bool) {
        unsafe { melo_set_like_state(active) };
    }

    fn set_shuffle_mode(&self, mode: u8) {
        unsafe { melo_set_shuffle_state(mode as i32) };
    }

    fn set_privacy_mode(&self, enabled: bool) {
        unsafe { melo_set_privacy_mode(enabled) };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn push_now_playing(meta: &TrackMetadata, position_secs: f32) {
    let Ok(title)  = CString::new(meta.title.as_str())  else { return };
    let Ok(artist) = CString::new(meta.artist.as_str()) else { return };

    let album_c = meta.album.as_deref().and_then(|s| CString::new(s).ok());
    let album_ptr = album_c
        .as_ref()
        .map(|c| c.as_ptr())
        .unwrap_or(std::ptr::null());

    unsafe {
        melo_update_now_playing(title.as_ptr(), artist.as_ptr(), album_ptr, position_secs);
    }
}
