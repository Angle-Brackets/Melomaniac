# Audio Bridge — Implementation Reference

Design notes and decisions for the `melomaniac-audio` crate and its integration
into the Tauri command layer. Read this before touching anything in
`src-tauri/crates/audio/` or `src-tauri/src/lib.rs`.

---

## Current state

| File | Status |
|---|---|
| `src-tauri/Cargo.toml` | Workspace root, `crates/audio` member, `melomaniac-audio` dep wired |
| `src-tauri/crates/audio/Cargo.toml` | Created, `thiserror` + `serde` deps |
| `src-tauri/crates/audio/src/lib.rs` | `AudioBridge` trait, `AudioSource`, `TrackMetadata`, `AudioEvent`, `AudioError` defined and compiling |
| `src-tauri/src/lib.rs` | Still template scaffolding — no bridge wired yet |

---

## File structure to build toward

```
src-tauri/
  crates/
    audio/
      src/
        lib.rs          ← done: trait + types
        desktop.rs      ← TODO: rodio + symphonia impl
        mobile.rs       ← TODO: thin wrapper over community plugins
      Cargo.toml
  src/
    lib.rs              ← TODO: wire bridge into Tauri state + commands
    audio.rs            ← TODO: Tauri command handlers (audio_load, audio_play, …)
```

---

## Architecture recap

```
Frontend (React)
  │  invoke("audio_load", …) / listen("audio://event")
  ▼
Tauri command layer  (src-tauri/src/audio.rs)
  │  hash → PathBuf resolution happens here (CAS layer, not in the bridge)
  │  State<Arc<dyn AudioBridge>>
  ▼
AudioBridge trait  (crates/audio/src/lib.rs)
  ├── DesktopBridge  (cfg(desktop)) — rodio + symphonia
  └── MobileBridge   (cfg(mobile))  — tauri-plugin-native-audio + media-session
```

Event flow is one-way from bridge back to Tauri:
```
Bridge impl  →  mpsc::Sender<AudioEvent>  →  Tauri background task  →  app.emit("audio://event")  →  Frontend
```

---

## Desktop backend  (`desktop.rs`)

### Crate choices

| Role | Crate | Notes |
|---|---|---|
| Audio output | `rodio 0.22` | CoreAudio / WASAPI / ALSA via `cpal` |
| Decoding | `symphonia 0.5.4` | Use stable, not `0.6.0-alpha.2` |
| Symphonia codecs | `symphonia-bundle-mp3`, `symphonia-codec-flac`, `symphonia-codec-aac` | Enable only what's needed |

`rodio` alone ships with very limited codec support. `symphonia` must be wired
in explicitly via `rodio`'s `decoder` feature + symphonia feature flags.

Add to `crates/audio/Cargo.toml` under `[target.'cfg(not(target_os = "ios"))'.dependencies]`
and `[target.'cfg(not(target_os = "android"))'.dependencies]` (or simply
`[target.'cfg(desktop)'.dependencies]` once Tauri's `cfg(desktop)` alias is confirmed):

```toml
[target.'cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))'.dependencies]
rodio = { version = "0.22", features = ["symphonia-all"] }
```

`symphonia-all` enables all symphonia codecs through rodio's re-export —
simpler than listing individual codec crates.

### Thread safety problem with rodio `OutputStream`

`rodio::OutputStream` is **not `Send`** on some platforms (particularly macOS,
where CoreAudio requires operations on the thread that created the stream).
This conflicts with Tauri's managed state, which requires `T: Send + Sync`.

**Solution:** Spawn a dedicated audio thread at startup. The `DesktopBridge`
struct holds only `Send`-safe handles:

```
Audio thread (long-lived, created once at app startup)
  owns: OutputStream, OutputStreamHandle, Sink
  communicates via: mpsc channels (cmd_tx / cmd_rx)

DesktopBridge (stored in Tauri state — must be Send + Sync)
  holds: cmd_tx: Sender<AudioCommand>   ← sends commands to audio thread
         event_tx: Sender<AudioEvent>   ← forwards events to Tauri layer
         position: Arc<AtomicU64>       ← shared position counter (ms)
         duration: Arc<AtomicU64>       ← shared duration (ms)
```

The audio thread loop processes `AudioCommand` variants (`Load`, `Play`,
`Pause`, `Stop`, `Seek`, `SetVolume`) and writes position ticks to the atomic.

### Position tracking

`rodio::Sink::get_pos()` returns elapsed time since last `play()`, adjusted for
seeks. Poll this on the audio thread at ~250 ms intervals and send
`AudioEvent::PositionChanged(ms)` on the event channel when the value changes.
Do **not** expose raw polling to the frontend — let the `requestAnimationFrame`
loop in React interpolate between ticks.

### Seeking

`rodio::Sink::try_seek(duration)` is available in rodio 0.17+. It resets the
internal elapsed counter correctly. After a seek, reset the position atomic and
send one immediate `PositionChanged` event.

---

## Mobile backend  (`mobile.rs`)

### Community plugins

| Plugin | Version | Role |
|---|---|---|
| `tauri-plugin-native-audio` | `1.0.5` | AVPlayer (iOS) + ExoPlayer/Media3 (Android) playback |
| `tauri-plugin-media-session` | `0.2.4` | Lockscreen controls + now-playing metadata (both platforms) |

### ⚠️ Open question before implementing

It is not yet confirmed whether `tauri-plugin-native-audio` exposes a **Rust
API** (callable from `lib.rs` / `mobile.rs`) or only a **JavaScript frontend
API** (callable only from the JS/TS side via `invoke`). Check the plugin's
`src/lib.rs` for an `impl<R: Runtime> NativeAudioExt<R> for AppHandle<R>`
pattern — that's the sign of a proper Rust API.

If only a JS API exists, the `MobileBridge` Rust struct would have to call
`app.invoke(...)` internally, which is unusual. In that case, consider calling
the plugin commands directly from the frontend and skipping the Rust bridge
layer for mobile — the trait would only be instantiated on desktop, with mobile
handled entirely through the JS plugin bindings.

**Resolve this before writing a single line of `mobile.rs`.**

### iOS-specific config (after Xcode is installed)

1. `src-tauri/gen/apple/melomaniac_iOS/Info.plist`
   ```xml
   <key>UIBackgroundModes</key>
   <array>
     <string>audio</string>
   </array>
   ```

2. App delegate / scene setup (Swift, inside the plugin or generated project):
   ```swift
   try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
   try AVAudioSession.sharedInstance().setActive(true)
   ```
   This must run before any audio is loaded. Without it, audio stops when the
   screen locks.

3. Lockscreen controls via `MPRemoteCommandCenter` — `tauri-plugin-media-session`
   should handle this, but verify it wires up `nextTrackCommand`,
   `previousTrackCommand`, `playCommand`, and `pauseCommand`.

### Android-specific config (after Android SDK is set up)

1. `AndroidManifest.xml` permissions:
   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
   ```

2. Declare the `MediaSessionService` as a service in the manifest.

3. A persistent foreground notification is required for background playback on
   Android 8+ (API 26). The notification must show play/pause/skip controls.
   `tauri-plugin-native-audio` may handle this — verify before writing custom
   notification code.

---

## Tauri command layer  (`src-tauri/src/audio.rs`)

### State type

```rust
// In lib.rs setup:
app.manage(AudioState {
    bridge: Arc<Box<dyn AudioBridge>>,
    event_rx: Mutex<Receiver<AudioEvent>>,
});
```

Or more ergonomically, `Arc<dyn AudioBridge>` directly since the trait requires
`Send + Sync`.

### Commands to implement

| Command | Signature | Notes |
|---|---|---|
| `audio_load` | `(hash: String, metadata: TrackMetadata)` | Resolves hash → PathBuf via CAS, then calls `bridge.load()` |
| `audio_play` | `()` | |
| `audio_pause` | `()` | |
| `audio_stop` | `()` | |
| `audio_seek` | `(position_ms: u64)` | |
| `audio_set_volume` | `(volume: f32)` | |
| `audio_position` | `() -> u64` | Returns current position in ms |

The command layer takes a `hash: String`, not a `PathBuf` — path resolution is
its responsibility, not the frontend's and not the bridge's.

### Event forwarding

Spawn a Tauri async task at startup that receives `AudioEvent` from the bridge
and emits them to the frontend:

```rust
tauri::async_runtime::spawn(async move {
    while let Ok(event) = event_rx.recv() {
        app_handle.emit("audio://event", &event).ok();
    }
});
```

Frontend listens via:
```ts
import { listen } from "@tauri-apps/api/event";
await listen("audio://event", (e) => { /* update Zustand store */ });
```

---

## `AudioSource::Stream` — P3 unlock checklist

When streaming is ready to implement, the changes are:

1. Remove `sealed::Unimplemented` from the `Stream` variant, replace with a
   proper URL type (e.g., `url::Url` from the `url` crate).
2. Desktop: implement a buffered HTTP source adapter for rodio, or switch to
   symphonia's `MediaSource` trait directly with range-request seeking.
3. Mobile: AVPlayer and ExoPlayer both accept HTTP URLs natively — the impl
   change is trivial (pass the URL string instead of a file path).
4. Auth: the Tauri command layer generates a short-lived signed URL from the
   Axum sync server before constructing `AudioSource::Stream`.

No other part of the codebase needs to change.

---

## Decisions already locked in

| Decision | Rationale |
|---|---|
| `PathBuf` at the trait boundary, not hash or URI | Bridge has no knowledge of CAS layout; path resolution is the command layer's job |
| `AudioSource::Stream` is uninhabitable via `sealed::Unimplemented` | Documents P3 intent while making accidental use a compile error |
| `AudioBridge: Send + Sync` required | Tauri managed state requires it |
| Interior mutability inside implementations | Trait methods take `&self` to allow `Arc<dyn AudioBridge>` without a `Mutex` at the state level |
| Single-track lifecycle only in the trait | Queue, crossfade, and A/B loop live above this layer |
| `mpsc` channel for events, not callbacks | Callbacks across FFI boundaries are unsound; channels are clean and async-friendly |
| `symphonia 0.5.4` (stable), not `0.6.0-alpha.2` | Stability over features at this stage |
