# iOS Audio Bridge — Design Reference

Implementation reference for `IosBridge` and the Swift layer it calls.
Read this before touching anything in `crates/audio/ios/` or `crates/audio/src/ios.rs`.

---

## Why custom Swift FFI, not a plugin

`tauri-plugin-native-audio` is JS-first: the frontend calls it directly, bypassing the
`AudioBridge` trait entirely on mobile. Every future audio feature (Smart Loop A/B,
crossfade, gapless playback) would then need two implementations — one in Rust for
desktop and one in TypeScript for mobile. The `AudioBridge` trait exists to prevent
exactly that split. Custom Swift FFI keeps Rust as the single control plane on all
platforms.

---

## Directory layout (after implementation)

```
crates/audio/
  src/
    ios.rs              ← IosBridge: extern "C" calls + monitoring thread
    lib.rs              ← AudioBridge trait, TrackMetadata, AudioEvent, AudioError
  ios/
    DESIGN.md           ← this file
    Sources/
      MelomaniacPlayer.swift   ← AVAudioPlayer wrapper, @_cdecl exports
  build.rs              ← compiles Swift on iOS; no-op on other targets
```

---

## Swift layer (`ios/Sources/MelomaniacPlayer.swift`)

A file-scope actor wrapping `AVAudioPlayer`. All state is module-global so the
`@_cdecl` C-callable functions (which have no `self`) can reach it.

### Exported C symbols

| Symbol | Signature | Notes |
|---|---|---|
| `melo_configure_session` | `() -> Bool` | Sets `AVAudioSession.category = .playback`. Call once at startup. |
| `melo_load` | `(UnsafePointer<CChar>, UnsafePointer<CChar>?) -> Bool` | args: absolute path, MIME type hint (may be NULL). Returns false on error. |
| `melo_play` | `() -> Bool` | Returns false if not loaded. |
| `melo_pause` | `()` | No-op if not playing. |
| `melo_stop` | `()` | Releases player, resets position. |
| `melo_seek` | `(UInt64)` | Position in milliseconds, clamped to duration. |
| `melo_set_volume` | `(Float)` | Clamped to 0.0–1.0. |
| `melo_position_ms` | `() -> UInt64` | Current position. 0 if no track loaded. |
| `melo_duration_ms` | `() -> UInt64` | Track duration. 0 if unknown. |
| `melo_is_playing` | `() -> Bool` | True only while actively playing (not paused). |
| `melo_is_finished` | `() -> Bool` | True once after natural playback end; resets on next `melo_load`. |
| `melo_update_now_playing` | `(UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>?, Float)` | args: title, artist, album (may be NULL), position_secs. Updates `MPNowPlayingInfoCenter`. |
| `melo_register_remote_commands` | `(MeloCommandCallback)` | Registers play/pause/next/prev handlers on `MPRemoteCommandCenter`. Callback is called with a `MeloCommand` integer. |

```swift
// Callback type passed from Rust to Swift for remote command events
typealias MeloCommandCallback = @convention(c) (Int32) -> Void

// MeloCommand values (matches Rust enum in ios.rs)
// 0 = Play, 1 = Pause, 2 = NextTrack, 3 = PreviousTrack, 4 = TogglePlayPause
```

### AVAudioPlayer initialisation (extension-less CAS blobs)

```swift
// Primary: use stored MIME type hint
if let hint = mimeTypeHint {
    player = try AVAudioPlayer(contentsOf: url, fileTypeHint: hint)
} else {
    // Fallback: detect from magic bytes
    player = try AVAudioPlayer(contentsOf: url,
                               fileTypeHint: detectMimeType(url))
}
```

`detectMimeType` reads the first 12 bytes and matches known signatures:

| Format | Magic bytes | MIME type |
|---|---|---|
| MP3 | `ID3` (0x49 0x44 0x33) or sync `0xFF 0xFB/F3/F2` | `audio/mpeg` |
| FLAC | `fLaC` (0x66 0x4C 0x61 0x43) | `audio/flac` |
| M4A/AAC | `ftyp` at offset 4 (0x66 0x74 0x79 0x70) | `audio/mp4` |
| WAV | `RIFF` (0x52 0x49 0x46 0x46) | `audio/wav` |
| OGG Vorbis | `OggS` (0x4F 0x67 0x67 0x53) | `audio/ogg` |

Returns `nil` (no hint) if the format is unrecognised, letting AVAudioPlayer try
on its own.

### Background audio + lock screen controls

**AVAudioSession** (call `melo_configure_session` before first `melo_load`):
```swift
try AVAudioSession.sharedInstance().setCategory(
    .playback,
    mode: .default,
    options: []
)
try AVAudioSession.sharedInstance().setActive(true)
```
`.playback` category: audio continues when the device is locked or the silent
switch is engaged. This is the only category that allows uninterrupted background
audio for a music player.

**MPNowPlayingInfoCenter** (call `melo_update_now_playing` after each load/seek):
```swift
MPNowPlayingInfoCenter.default().nowPlayingInfo = [
    MPMediaItemPropertyTitle:                 title,
    MPMediaItemPropertyArtist:               artist,
    MPMediaItemPropertyAlbumTitle:           album,   // omit key if nil
    MPMediaItemPropertyPlaybackDuration:     duration_secs,
    MPNowPlayingInfoPropertyElapsedPlaybackTime: position_secs,
    MPNowPlayingInfoPropertyPlaybackRate:    isPlaying ? 1.0 : 0.0,
]
```

**MPRemoteCommandCenter** (call `melo_register_remote_commands` once at startup):
Registers play, pause, togglePlayPause, nextTrack, previousTrack handlers. Each
handler calls the Rust-provided `MeloCommandCallback` with the appropriate integer
code, which `IosBridge` routes through its `event_tx` channel.

---

## Rust layer (`src/ios.rs`)

`IosBridge` stores:
- `position_ms: Arc<AtomicU64>` — updated by monitoring thread
- `event_tx: Sender<AudioEvent>` — forwards to Tauri event layer
- `remote_cmd_tx: Sender<RemoteCommand>` — receives lock screen commands

### Monitoring thread

Spawned in `IosBridge::new`. Polls Swift every 250 ms (matches desktop pattern):

```
loop {
    sleep(250ms)
    pos = melo_position_ms()
    position_ms.store(pos)
    event_tx.send(PositionChanged(pos))

    if melo_is_finished() {
        event_tx.send(TrackEnded)
    }
}
```

The thread exits when `event_tx` is dropped (i.e. the bridge is deallocated).

### Remote command callback

```rust
extern "C" fn remote_cmd_handler(code: i32) {
    // routes to remote_cmd_tx
}
```

`IosBridge::new` calls `melo_register_remote_commands(remote_cmd_handler)`.
A second thread reads `remote_cmd_rx` and emits the appropriate `audio://event`
extension (play/pause/skip handled upstream in the Tauri command layer).

---

## Build script (`build.rs`)

```rust
fn main() {
    #[cfg(target_os = "ios")]
    {
        println!("cargo:rerun-if-changed=ios/Sources/MelomaniacPlayer.swift");
        tauri_build::mobile::link_swift_library(
            "MelomaniacPlayer",
            "ios/Sources",
        );
    }
}
```

The script is a no-op on desktop, so it does not affect the desktop CI run.

---

## Info.plist requirements

These must be present in the iOS app target (added via `tauri.conf.json` →
`bundle.iOS.infoPlist` or directly in `gen/apple`):

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

Without `UIBackgroundModes: ["audio"]`, iOS suspends the app within ~30 seconds
of backgrounding regardless of AVAudioSession configuration.

---

## Verification checklist (iOS simulator)

| Test | Expected result |
|---|---|
| `audio_load` + `audio_play` | Audio from simulator speaker |
| `audio_pause` | Silence; position held |
| `audio_play` again | Resumes from same position |
| `audio_seek(30000)` | Jumps to ~0:30 |
| `audio_set_volume(0.2)` | Audibly quieter |
| Track plays to end | `TrackEnded` event → queue advances |
| App backgrounded | Audio continues |
| Lock screen displayed | Title + artist shown |
| Lock screen play/pause | Toggles playback |
| Lock screen next button | `NextTrack` event fires |

---

## Known constraints and deferred work

| Item | Status |
|---|---|
| Audio interruptions (phone call, other app) | Deferred — needs `AVAudioSession` interruption notification handler in Swift |
| Artwork on lock screen | Deferred — requires resolving artwork CAS blob to `UIImage` |
| Playback rate control | Not in `AudioBridge` trait; add when needed |
| Android (`AndroidBridge`) | P1 — same polling architecture, Kotlin + Media3 + `MediaSessionService` |
| Streaming (`AudioSource::Stream`) | P3 — replace `AVAudioPlayer` with `AVPlayer` for HLS/HTTP sources |
