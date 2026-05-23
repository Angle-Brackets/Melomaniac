# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Desktop dev (Vite + Tauri)
npm run tauri dev

# Frontend only (Vite at http://localhost:1420)
npm run dev

# Desktop UI in a mobile-sized window (no Rust needed)
npm run dev:mobile

# iOS simulator
npm run ios:sim

# iOS on a real device (uses scripts/ios-dev.mjs)
npm run ios:dev

# Type-check + build frontend
npm run build

# Run tests (Vitest)
npm test
```

There are no Rust tests at this time.

## Architecture

Melomaniac is a music player built with **Tauri 2** (Rust backend) + **React 18 / TypeScript** (frontend), targeting both desktop (macOS/Linux/Windows) and iOS.

### Crate workspace (`src-tauri/crates/`)

| Crate | Purpose |
|---|---|
| `melomaniac-audio` | Platform audio playback (`AudioBridge` trait + desktop rodio impl) |
| `melomaniac-storage` | SQLite DB + content-addressed CAS blob store |
| `melomaniac-sync` | LAN peer discovery, HTTP sync server/client, merge engine |

### Communication model

Frontend → Rust: `invoke()` from `@tauri-apps/api/core`. Commands declared with `#[tauri::command]` in `src-tauri/src/*.rs`, registered in `lib.rs` via `tauri::generate_handler![]`.

Rust → Frontend: `AppHandle::emit("event://name", &payload)` — listen with `listen(...)` from `@tauri-apps/api/event`.

### Audio backend (`crates/audio/`)

`AudioBridge` trait with platform implementations:
- **Desktop** (`src/desktop/`): `DesktopBridge` — dedicated OS audio thread (required because `cpal::Stream` is `!Send` on macOS). Exposes `Send`-safe handles (`SyncSender`, `Arc<AtomicU64>`). Uses rodio 0.22: `DeviceSinkBuilder::open_default_sink()`, `MixerDeviceSink`.
- **iOS**: thin wrapper — playback not yet implemented on iOS (audio bridge stubs).

`AudioEvent` variants emitted to the frontend: `TrackEnded`, `PositionChanged(u64)`, `Error(String)`.

Audio commands (all in `src-tauri/src/audio.rs`):
| Command | Args | Returns |
|---|---|---|
| `audio_load` | `path: String, metadata: TrackMetadata` | `Result<(), String>` |
| `audio_play` | — | `Result<(), String>` |
| `audio_pause` | — | `Result<(), String>` |
| `audio_stop` | — | `Result<(), String>` |
| `audio_seek` | `position_ms: u64` | `Result<(), String>` |
| `audio_set_volume` | `volume: f32` | `Result<(), String>` |
| `audio_position` | — | `Result<u64, String>` |

`TrackMetadata` fields: `title`, `artist`, `album`, `artwork_path`, `duration_ms`.

### Storage & artwork (`crates/storage/`)

Tracks are stored in a **content-addressed store (CAS)** under `app_data_dir/cas/` as BLAKE3-hashed blobs. SQLite DB holds metadata in a `tracks` table (`artwork_hash: Option<String>` etc.) and a DAG of `commits` + `branches` per playlist.

Artwork is extracted at ingest time as a **separate CAS blob**. At runtime, `track_get_artwork` goes DB → `artwork_hash` → CAS blob → base64 data URL. Multiple tracks on the same album share one blob. During sync both the audio blob **and** the artwork blob must be transferred explicitly.

### Sync system (`crates/sync/`)

LAN peer-to-peer sync using mDNS-SD for discovery and an Axum HTTP server on port 7700 for data transfer. Both desktop and iOS run an HTTP server; peers pull from each other.

**Key modules:**
- `http_server.rs` — shared Axum router (endpoints: `/ping`, `/manifest`, `/hashes`, `/tracks`, `/blob/:hash`, `/commits/:id/:branch`, `/pair`). Auth via Ed25519-signed timestamp header.
- `desktop/mod.rs` — `DesktopSyncBridge`: mDNS-SD via `mdns-sd` crate, browses and advertises `_melomaniac._tcp.local.`
- `ios.rs` — `IosSyncBridge`: NWBrowser/NWListener via Swift FFI (`melo_sync_register_service`, `melo_sync_start_discovery`), Axum HTTP server started from Rust.
- `merge.rs` — 3-way DAG merge (`diff_trees`), producing `ConflictChunk` for unresolvable conflicts.

**Sync flow:**
1. `triggerAutoSync` (frontend poll) fetches peer manifest, diffs branch HEADs, calls `sync_playlist` per changed branch.
2. `sync_playlist` pulls the peer's commit chain, downloads missing blobs, runs 3-way merge.
3. Fast-forward → branch HEAD updated immediately. True merge with no conflicts → auto-merge commit written. Conflicts → stored in `pending_merges`, returned to frontend as `SyncReport.conflicts`.
4. `sync_with_peer` (manual "sync now") fetches the full manifest and syncs all changed branches across all shared playlists in one call.

Sync commands (all in `src-tauri/src/sync.rs`):
`sync_get_peers`, `sync_with_peer`, `sync_playlist`, `sync_playlist_branches`, `sync_fetch_peer_manifest`, `sync_refresh_metadata`, `sync_generate_qr_payload`, `sync_accept_qr_pairing`, `sync_known_devices`, `sync_remove_device`, `sync_get_fingerprint`, `sync_get_pending_conflicts`, `resolve_merge_conflict`, `sync_open_discovery_window`, `sync_close_discovery_window`, `sync_is_discovery_open`.

### Frontend layout (`src/`)

`App.tsx` reads `VITE_PLATFORM` (set to `"ios"` for mobile builds) and renders either `DesktopApp` or `MobileApp`.

**Desktop** (`src/desktop/`):
- `DesktopApp.tsx` — three-column layout: `Sidebar` (playlist nav) + main panel (library/editor) + `RightPanel` (queue/info).
- Components: `Sidebar`, `LibraryView`, `EditorView`, `TrackList`, `PlayerControls`, `QueuePanel`, `CommitGraph`, `DiffViewer`, `PairingModal`, `PeerPlaylistsModal`, `SettingsModal`, and more.

**Mobile** (`src/mobile/`):
- `MobileApp.tsx` — tab-based nav: Library, Discover, Now Playing, Settings.
- Components: `Library`, `PlaylistDetail`, `NowPlaying`, `Discover`, `Settings`.

**Shared components** (`src/components/`): `DiffViewer`, `PairingModal`, `PeerPlaylistsModal`, `MusicCard`, and others used by both platforms.

### State management (`src/store/`)

Zustand store with five slices:
| Slice | Key state |
|---|---|
| `librarySlice` | `tracks`, `playlists`, artwork loading |
| `playbackSlice` | `currentTrack`, `isPlaying`, `volume`, AB loop points |
| `playlistSlice` | active playlist, branches, commit history |
| `queueSlice` | playback queue, shuffle (`Random`=Fisher-Yates, `Smart`=artist-spread weighted) |
| `syncSlice` | `livePeers`, `knownDevices`, `pendingConflictPlaylists`, `downloadProgress`, `mergeConflicts` |

`syncSlice.triggerAutoSync` — called on every peer poll; diffs `lastSeenHeads` and auto-syncs changed branches. Surfaces conflicts via `openDiffViewer` and shows ⚠️ badges on affected playlists via `pendingConflictPlaylists`.

### Key config files
- `src-tauri/tauri.conf.json` — window size, app identifier, before-dev/build commands
- `vite.config.ts` — locked to port 1420; excludes `src-tauri/` from HMR watch
- `src-tauri/crates/sync/ios/` — Swift package (`MelomaniacSync`) providing NWBrowser/NWListener FFI
