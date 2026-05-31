use std::path::PathBuf;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub mod desktop;

#[cfg(target_os = "ios")]
pub mod ios;

// ── Uninhabited marker ────────────────────────────────────────────────────────
//
// `sealed::Unimplemented` has no variants, so no value of that type can ever
// be created. Any enum variant that contains it is therefore also impossible
// to construct — attempting to do so is a compile-time error.
//
// The module is private to this crate, so the type cannot even be named from
// outside, let alone constructed.
mod sealed {
    #[derive(Debug)]
    pub enum Unimplemented {}
}

// ── AudioSource ───────────────────────────────────────────────────────────────

/// The source of audio passed to an [`AudioBridge`] implementation.
///
/// Resolve a track's BLAKE3 hash → [`PathBuf`] in the Tauri command layer
/// before constructing this value; the bridge has no knowledge of the CAS
/// storage layout.
#[derive(Debug)]
pub enum AudioSource {
    /// A local file path resolved from the CAS object store.
    File(PathBuf),

    /// Remote streaming — **reserved for P3, not yet implemented**.
    ///
    /// This variant cannot be constructed. `sealed::Unimplemented` is an
    /// uninhabited type; no value of it can ever exist, making this variant
    /// unreachable by construction. To enable streaming, replace the marker
    /// with a real URL type and implement the streaming path in each platform
    /// backend (`desktop.rs`, `ios.rs`, `android.rs`).
    #[allow(dead_code)]
    Stream(String, sealed::Unimplemented),
}

// ── Supporting types ──────────────────────────────────────────────────────────

/// Metadata forwarded to the OS media session (lockscreen / now-playing UI).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// Absolute path to artwork image for lockscreen display.
    pub artwork_path: Option<PathBuf>,
    pub duration_ms: Option<u64>,
    /// IANA media type of the audio blob (e.g. `"audio/mpeg"`, `"audio/flac"`).
    /// Passed to iOS as `AVAudioPlayer(contentsOf:fileTypeHint:)` and to Android as
    /// `MediaItem.Builder().setMimeType(...)`. NULL-safe: platforms fall back to
    /// magic-byte detection when absent.
    #[serde(default)]
    pub mime_type: Option<String>,
}

/// Events emitted by a running [`AudioBridge`] back to the Tauri layer.
/// Must be `Serialize` so `AppHandle::emit` can send it to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub enum AudioEvent {
    /// The track played to completion without being stopped externally.
    TrackEnded,
    /// Periodic position tick while playing, in milliseconds.
    PositionChanged(u64),
    /// Emitted once when a track finishes loading; carries the total duration in ms.
    /// May fire with 0 if the format does not expose duration (e.g. live streams).
    DurationKnown(u64),
    /// A non-fatal error occurred; playback may continue with the next track.
    Error(String),
    /// Lock-screen remote: play button pressed.
    RemotePlay,
    /// Lock-screen remote: pause button pressed.
    RemotePause,
    /// Lock-screen remote: next-track button pressed.
    RemoteNextTrack,
    /// Lock-screen remote: previous-track button pressed.
    RemotePreviousTrack,
    /// Lock-screen remote: headphone toggle (play/pause).
    RemoteTogglePlayPause,
    /// Lock-screen / Control Centre scrubber: user seeked to position (milliseconds).
    RemoteSeek(u64),
}

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("source not found: {0}")]
    SourceNotFound(String),

    #[error("unsupported audio format: {0}")]
    UnsupportedFormat(String),

    #[error("playback error: {0}")]
    Playback(String),

    #[error("seek out of bounds: requested {requested_ms}ms exceeds duration {duration_ms}ms")]
    SeekOutOfBounds {
        requested_ms: u64,
        duration_ms: u64,
    },

    #[error("bridge not initialised — call load() before play()")]
    NotLoaded,
}

// ── AudioBridge trait ─────────────────────────────────────────────────────────

/// Cross-platform audio playback interface.
///
/// # Platform implementations
/// - **Desktop** (`desktop.rs`): `rodio` + `symphonia`
/// - **iOS** (`ios.rs`): delegates to `tauri-plugin-native-audio` (AVPlayer)
/// - **Android** (`android.rs`): delegates to `tauri-plugin-native-audio` (Media3)
///
/// # Responsibilities
/// This trait covers single-track lifecycle only. Queue management, crossfade,
/// and A/B loop logic live above this layer in the Tauri command handlers.
///
/// # Event delivery
/// Implementations receive an `event_tx` channel at construction time and send
/// [`AudioEvent`] values on it. The Tauri layer translates these into frontend
/// events via `AppHandle::emit`.
pub trait AudioBridge: Send + Sync {
    /// Load `source` and prepare for playback. Must be called before [`play`](Self::play).
    /// Calling `load` while a track is playing implicitly stops it first.
    fn load(&self, source: &AudioSource, metadata: TrackMetadata) -> Result<(), AudioError>;

    /// Begin or resume playback. Errors if [`load`](Self::load) has not been called.
    fn play(&self) -> Result<(), AudioError>;

    /// Pause playback, retaining the current position.
    fn pause(&self) -> Result<(), AudioError>;

    /// Stop playback and release the current source.
    fn stop(&self) -> Result<(), AudioError>;

    /// Seek to an absolute position. Position is clamped to track duration by
    /// implementations; callers need not guard against overflow.
    fn seek(&self, position_ms: u64) -> Result<(), AudioError>;

    /// Set playback volume. `volume` is clamped to `0.0..=1.0` by implementations.
    fn set_volume(&self, volume: f32) -> Result<(), AudioError>;

    /// Returns the current playback position in milliseconds, or `0` if no
    /// track is loaded.
    fn position_ms(&self) -> Result<u64, AudioError>;
}
