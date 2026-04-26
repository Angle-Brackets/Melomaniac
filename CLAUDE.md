# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the full Tauri desktop app in development mode
npm run tauri dev

# Run only the frontend (Vite dev server at http://localhost:1420)
npm run dev

# Type-check and build the frontend for production
npm run build

# Build the distributable desktop app
npm run tauri build
```

There are no tests at this time.

## Architecture

Melomaniac is a desktop (and future mobile) music player built with **Tauri 2** (Rust backend) + **React 18 / TypeScript** (frontend), bundled via Vite.

### Communication model
The frontend calls Rust via `invoke()` from `@tauri-apps/api/core`. Commands are declared with `#[tauri::command]` in `src-tauri/src/audio.rs` and registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`. The backend pushes events to the frontend via `AppHandle::emit("audio://event", &event)` — listen with `listen("audio://event", ...)` from `@tauri-apps/api/event`.

### Audio commands (all live in `src-tauri/src/audio.rs`)
| Command | Args | Returns |
|---|---|---|
| `audio_load` | `path: String, metadata: TrackMetadata` | `Result<(), String>` |
| `audio_play` | — | `Result<(), String>` |
| `audio_pause` | — | `Result<(), String>` |
| `audio_stop` | — | `Result<(), String>` |
| `audio_seek` | `position_ms: u64` | `Result<(), String>` |
| `audio_set_volume` | `volume: f32` | `Result<(), String>` |
| `audio_position` | — | `Result<u64, String>` |

`TrackMetadata` fields (snake_case, passed as-is from JS): `title`, `artist`, `album`, `artwork_path`, `duration_ms`.

### Audio backend (`src-tauri/crates/audio/`)
Cargo workspace member `melomaniac-audio`. All platform-agnostic types live in `crates/audio/src/lib.rs`: `AudioBridge` trait, `AudioSource`, `TrackMetadata`, `AudioEvent`, `AudioError`.

Desktop implementation is in `crates/audio/src/desktop/` (gated on `cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))`):
- `desktop/audio.rs` — `DesktopBridge`: spawns a dedicated OS audio thread (required because `cpal::Stream` is `!Send` on macOS). All rodio calls happen on that thread; the struct exposes only `Send`-safe handles (`SyncSender`, `Arc<AtomicU64>`). Uses rodio 0.22 API: `DeviceSinkBuilder::open_default_sink()`, `MixerDeviceSink`, `Player::connect_new(mixer)`.
- `desktop/mod.rs` — re-exports `DesktopBridge`.

`AudioEvent` variants emitted to the frontend: `TrackEnded`, `PositionChanged(u64)`, `Error(String)`.

`AudioSource::Stream` exists but is uninhabitable (`sealed::Unimplemented`) — compile-time enforcement that streaming is not yet implemented (P3).

### Frontend layout (`src/`)
`App.tsx` composes four components stacked vertically:
1. **`Navbar`** — menu toggle + settings button (DaisyUI swap)
2. **`MusicCarousel`** — Swiper coverflow carousel wrapping multiple `MusicCard` instances
3. **`MusicInfo`** — static song/artist display (currently hardcoded)
4. **`MusicControls`** — full playback control bar (play/pause, skip, shuffle, repeat, like, add) — not yet wired to invoke

Styling uses **Tailwind CSS** + **DaisyUI** component classes. Icons come from **react-icons**.

### Key config files
- `src-tauri/tauri.conf.json` — window size (800×600), app identifier, before-dev/build commands
- `vite.config.ts` — locked to port 1420; excludes `src-tauri/` from HMR watch
