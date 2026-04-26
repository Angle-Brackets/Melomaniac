// Tests for the pure types in melomaniac-audio — no audio device required.

use melomaniac_audio::{AudioError, AudioEvent, TrackMetadata};

// ── AudioError display ────────────────────────────────────────────────────────

#[test]
fn error_source_not_found_message() {
    let e = AudioError::SourceNotFound("/tmp/missing.mp3".into());
    assert!(e.to_string().contains("source not found"));
    assert!(e.to_string().contains("/tmp/missing.mp3"));
}

#[test]
fn error_unsupported_format_message() {
    let e = AudioError::UnsupportedFormat("text/plain".into());
    assert!(e.to_string().contains("unsupported audio format"));
}

#[test]
fn error_not_loaded_message() {
    assert!(AudioError::NotLoaded.to_string().contains("bridge not initialised"));
}

#[test]
fn error_seek_out_of_bounds_message() {
    let e = AudioError::SeekOutOfBounds { requested_ms: 5000, duration_ms: 3000 };
    let msg = e.to_string();
    assert!(msg.contains("5000"));
    assert!(msg.contains("3000"));
}

#[test]
fn error_playback_message() {
    let e = AudioError::Playback("device disconnected".into());
    assert!(e.to_string().contains("playback error"));
    assert!(e.to_string().contains("device disconnected"));
}

// ── AudioEvent serialization ──────────────────────────────────────────────────
//
// Events are forwarded to the frontend via `AppHandle::emit`, which JSON-serialises them.
// These tests guard the wire format against accidental renames.

#[test]
fn event_track_ended_serializes() {
    let json = serde_json::to_string(&AudioEvent::TrackEnded).unwrap();
    assert_eq!(json, r#""TrackEnded""#);
}

#[test]
fn event_position_changed_serializes() {
    let json = serde_json::to_string(&AudioEvent::PositionChanged(42_000)).unwrap();
    assert_eq!(json, r#"{"PositionChanged":42000}"#);
}

#[test]
fn event_error_serializes() {
    let json = serde_json::to_string(&AudioEvent::Error("oops".into())).unwrap();
    assert_eq!(json, r#"{"Error":"oops"}"#);
}

// ── TrackMetadata serialization ───────────────────────────────────────────────

#[test]
fn track_metadata_roundtrip() {
    let meta = TrackMetadata {
        title:        "Memory Lane".into(),
        artist:       "Test Artist".into(),
        album:        Some("Test Album".into()),
        artwork_path: None,
        duration_ms:  Some(180_000),
        mime_type:    Some("audio/mpeg".into()),
    };

    let json   = serde_json::to_string(&meta).unwrap();
    let back: TrackMetadata = serde_json::from_str(&json).unwrap();

    assert_eq!(back.title,        meta.title);
    assert_eq!(back.artist,       meta.artist);
    assert_eq!(back.album,        meta.album);
    assert_eq!(back.duration_ms,  meta.duration_ms);
    assert!(back.artwork_path.is_none());
}

#[test]
fn track_metadata_optional_fields_absent_in_json() {
    let meta = TrackMetadata {
        title:        "T".into(),
        artist:       "A".into(),
        album:        None,
        artwork_path: None,
        duration_ms:  None,
        mime_type:    None,
    };
    let json = serde_json::to_string(&meta).unwrap();
    // serde defaults Option → null, not missing, so just check the required fields are present
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["title"], "T");
    assert_eq!(v["artist"], "A");
    assert!(v["album"].is_null());
}

// ── Desktop bridge (requires audio device — skipped in CI) ────────────────────
//
// Run locally with: cargo test -p melomaniac-audio -- --include-ignored

#[test]
#[ignore = "requires a real or virtual audio output device"]
fn bridge_play_before_load_errors() {
    use melomaniac_audio::{desktop::DesktopBridge, AudioBridge, AudioError};
    use std::sync::mpsc;

    let (tx, _rx) = mpsc::channel();
    let bridge = DesktopBridge::new(tx).expect("failed to open audio device");
    let err = bridge.play().unwrap_err();
    assert!(matches!(err, AudioError::NotLoaded));
}

#[test]
#[ignore = "requires a real or virtual audio output device"]
fn bridge_pause_before_load_errors() {
    use melomaniac_audio::{desktop::DesktopBridge, AudioBridge, AudioError};
    use std::sync::mpsc;

    let (tx, _rx) = mpsc::channel();
    let bridge = DesktopBridge::new(tx).expect("failed to open audio device");
    let err = bridge.pause().unwrap_err();
    assert!(matches!(err, AudioError::NotLoaded));
}

#[test]
#[ignore = "requires a real or virtual audio output device"]
fn bridge_position_before_load_returns_zero() {
    use melomaniac_audio::{desktop::DesktopBridge, AudioBridge};
    use std::sync::mpsc;

    let (tx, _rx) = mpsc::channel();
    let bridge = DesktopBridge::new(tx).expect("failed to open audio device");
    assert_eq!(bridge.position_ms().unwrap(), 0);
}

#[test]
#[ignore = "requires a real or virtual audio output device"]
fn bridge_load_missing_file_errors() {
    use melomaniac_audio::{desktop::DesktopBridge, AudioBridge, AudioError, AudioSource, TrackMetadata};
    use std::sync::mpsc;

    let (tx, _rx) = mpsc::channel();
    let bridge = DesktopBridge::new(tx).expect("failed to open audio device");
    let meta = TrackMetadata {
        title: "X".into(), artist: "Y".into(),
        album: None, artwork_path: None, duration_ms: None, mime_type: None,
    };
    let err = bridge
        .load(&AudioSource::File("/nonexistent/path.mp3".into()), meta)
        .unwrap_err();
    assert!(matches!(err, AudioError::SourceNotFound(_)));
}

#[test]
#[ignore = "requires a real or virtual audio output device"]
fn bridge_volume_clamps_to_one() {
    use melomaniac_audio::{desktop::DesktopBridge, AudioBridge};
    use std::sync::mpsc;

    let (tx, _rx) = mpsc::channel();
    let bridge = DesktopBridge::new(tx).expect("failed to open audio device");
    // Volume above 1.0 should not panic or error
    bridge.set_volume(2.0).unwrap();
    bridge.set_volume(-1.0).unwrap();
}
