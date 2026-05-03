# Melomaniac — Development Plan

> Tasks are ordered by priority phase. Complete P0 fully before beginning P1.

---

## P0 — Core Engine (MVP)

### Tauri v2 Workspace
- [x] Initialise Tauri v2 project with Vite + React + TypeScript frontend
- [x] Upgrade all Tauri packages from RC to stable v2 (tauri 2.10.3, tauri-build 2.5.6, tauri-plugin-shell 2.3.5, @tauri-apps/cli/api 2.10.1)
- [x] Upgrade frontend toolchain (Vite 5→6, @vitejs/plugin-react 4→5, Swiper 11→12, 0 audit vulnerabilities)
- [x] Gitignore generated targets: `src-tauri/gen/apple`, `src-tauri/gen/android`, `src-tauri/gen/schemas`, `src-tauri/target`
- [x] Configure workspace for iOS and Android compilation targets (requires Xcode — fixed version mismatch for Xcode 15.4)
- [x] Verify a "Hello World" build runs on Desktop [x], iOS simulator [x], iOS real device [x] — Android emulator pending
- [ ] Set up project directory structure (`.melomaniac/objects/`, `src/`, `src-tauri/`)

### Native Audio Bridge ⚠️ (Highest Risk — Do First)
- [x] Set up `crates/audio` workspace crate (`melomaniac-audio`) inside `src-tauri/`
- [x] Define `AudioBridge` trait, `AudioSource` (`File` + uninhabitable `Stream` stub), `TrackMetadata`, `AudioEvent`, and `AudioError` in `crates/audio/src/lib.rs`
- [x] Implement desktop backend (`crates/audio/src/desktop.rs`) — dedicated audio thread, `MixerDeviceSink` + `Player` (rodio 0.22 API), `symphonia-all` codecs, atomic position tracking, volume persistence across loads
- [x] Wire `AudioState` into Tauri managed state; implement all seven Tauri commands in `src/audio.rs` (`audio_load`, `audio_play`, `audio_pause`, `audio_stop`, `audio_seek`, `audio_set_volume`, `audio_position`)
- [x] Spawn event-forwarding thread: `AudioEvent` → `AppHandle::emit("audio://event")` → frontend
- [x] Create stub `IosBridge` and update `lib.rs` feature flags to enable iOS compilation
- [x] Implement AVAudioPlayer bridge for iOS background audio — Swift FFI via `@_cdecl`, `swift-rs` SPM package at `crates/audio/ios/`; `IosBridge` in `crates/audio/src/ios.rs`; `UIBackgroundModes: audio` in `src-tauri/Info.ios.plist`
- [x] Verify background audio persistence when app is minimised on iOS (confirmed on device)
- [x] Implement lockscreen/Control Centre Now Playing widget — `MPNowPlayingInfoCenter` updated every 250 ms + immediately on play; `MPRemoteCommandCenter` (play, pause, next, prev, toggle) with token retention; `RemotePlay/RemotePause/RemoteNextTrack/RemotePreviousTrack/RemoteTogglePlayPause` variants added to `AudioEvent`
- [ ] Verify Now Playing widget appears on real device (simulator cannot show it — test when device controls are wired)
- [ ] Implement ExoPlayer / Media3 bridge for Android background audio
- [ ] Verify background audio persistence when app is minimised on Android
- [ ] Implement lockscreen controls (play, pause, skip) on Android
- [x] Expose `play`, `pause`, `seek`, `stop`, `audio_load`, `audio_set_volume`, `audio_position` Tauri commands to frontend

### yt-dlp Ingestion Wrapper
- [ ] Implement `std::process::Command` wrapper around `yt-dlp` binary
- [ ] Support audio-only download with format selection (FLAC/MP3)
- [ ] Implement error handling for failed or changed yt-dlp formats
- [ ] Bundle or document yt-dlp binary update strategy for end users
- [ ] Expose ingest command to frontend via Tauri invoke

### Content-Addressable Storage (CAS) Model
- [x] Implement `blake3` file hashing for ingested audio and image files (`crates/storage/src/cas.rs` — `CasStore::hash`)
- [x] Implement blob storage to `<app_data_dir>/objects/<xx>/<remaining-62>` with atomic write (`CasStore::write_blob`)
- [x] Implement deduplication check before writing a new blob (exists check in `write_blob`)
- [x] Define JSON Tree (playlist) manifest schema (`{ "tracks": [{ "hash", "ab_start_ms", "ab_end_ms" }] }` — committed as CAS blob via `branch_commit`)
- [x] Define and implement JSON Commit schema (tree_hash, parent, timestamp, device_id, message — `CommitRecord`)
- [x] Implement Commit read/write functions (`db.insert_commit`, `db.get_commit`, `db.get_commit_history`)
- [x] Set up SQLite database with `sqlx` (`crates/storage/src/db.rs` — WAL mode, foreign keys, migrations)
- [x] Implement SQLite schema for track metadata, plays/skips, playlists, branches, commits, commit_parents (migrations 0001–0004)
- [x] Implement indexer that reconciles SQLite against CAS on startup (`crates/storage/src/indexer.rs` — removes stale rows, logs orphan blobs)
- [x] Wire `StorageState` into Tauri app (`src-tauri/src/storage.rs` + `lib.rs`); expose 7 commands: `library_get_all`, `library_set_favorite`, `playlist_get_all`, `playlist_create`, `playlist_fork`, `branch_create`, `branch_commit`
- [x] Write integration tests for CAS, DB, and Indexer (18/18 passing)

### Axum Self-Hosted Sync Server
- [ ] Scaffold Axum server project inside workspace
- [ ] Implement `/status` endpoint
- [ ] Implement `/pull` endpoint (serve missing commits/trees/blobs to client)
- [ ] Implement `/push` endpoint (receive commits/trees/blobs from client)
- [ ] Dockerize server with a minimal `Dockerfile` and `docker-compose.yml`
- [ ] Document self-hosting setup in README

### React Frontend Scaffolding
- [x] Set up Zustand store with slices for queue, playback state, library, and playlist (`src/store/`)
  - `playbackSlice` — `isPlaying`, `loadedTrackHash`, `duration_ms`, `volume`; `position_ms` intentionally excluded (lives in `useRef` for rAF loop)
  - `queueSlice` — `queueTracks`, `currentIndex`, `ShuffleMode` (`Off`/`Random`/`Smart`), `RepeatMode` (`None`/`One`/`All`), `shuffledQueue` lookahead (default 20), `shuffleHistory` dedup; `Smart` uses Fisher-Yates permutation, `Random` samples with history dedup
  - `librarySlice` — `TrackMeta[]` with `favorited: boolean`; `toggleFavorite` uses optimistic update with rollback; stubs `library_get_all` / `library_set_favorite` Tauri commands
  - `playlistSlice` — `playlists: PlaylistMeta[]`, `currentCommitHash`; no-op until CAS/Commit layer is built
- [ ] Implement `requestAnimationFrame` progress bar loop via `useRef` (no React re-renders)
- [ ] Implement virtualized tracklist with `tanstack/react-virtual` (target: 10,000+ tracks)
- [ ] Build player controls UI (play, pause, seek, skip, volume)
- [ ] Build library view wired to SQLite metadata via Tauri invoke
- [ ] Build basic playlist view rendering Tree manifest tracks
- [x] Verify end-to-end audio playback on Desktop and iOS real device — `debug_play_test_track` async Tauri command (`#[cfg(debug_assertions)]`) embeds `tests/audio/test.mp3` via `include_bytes!`, writes to CAS, loads + plays via `spawn_blocking`; called from `App.tsx` (DEV only, 5 s delay)
- [ ] Wire `MusicControls` buttons to audio invoke commands (play, pause, seek, volume)
- [ ] Wire yt-dlp ingest UI (URL input → download → library refresh)

---

## P1 — Beta / Daily Driver

### Smart Loop (A/B Timestamps)
- [ ] Extend Tree manifest schema to support per-track A/B timestamp metadata
- [ ] Implement A/B seek logic in the native audio bridge (iOS)
- [ ] Implement A/B seek logic in the native audio bridge (Android)
- [ ] Build A/B loop UI controls in the player view

### Metadata Extraction
- [ ] Integrate `id3` crate for reading tags from ingested MP3/FLAC files
- [ ] Populate SQLite index with extracted title, artist, album, artwork hash
- [ ] Handle missing or malformed tags gracefully with fallback values
- [ ] Display extracted metadata in tracklist and player UI

### P2P Sync (LAN-First)
- [ ] Integrate `mdns-sd` for local device discovery
- [ ] Broadcast Melomaniac peer presence on app focus
- [ ] Detect recognised peers on the local network
- [ ] Integrate `quinn` (QUIC) for high-speed local data transfer
- [ ] Implement diff logic: compare local commit chain against peer's chain
- [ ] Implement blob/tree/commit transfer over QUIC
- [ ] Integrate `automerge` CRDTs for divergent offline playlist conflict resolution
- [ ] Test sync scenario: track added on device A offline, playlist reordered on device B offline, both come online
- [ ] Fall back to Axum HTTPS sync when no LAN peer is found

### UI Polish
- [x] Implement carousel view for albums / playlists — custom coverflow with cubic easing + 3D tilt
- [x] Refine info-dense tracklist layout — 10-column grid with drag reorder and context menu
- [x] Add artwork display in player and library views — gradient album art with per-pixel shine
- [ ] General visual polish pass (bugs remain from initial port — see Desktop UI section below)

---

## P2 — Power User & AI Features

### Semantic Playlist Generation
- [ ] Integrate `sqlite-vector-rs` for vector storage in SQLite
- [ ] Bundle or integrate a local sentence-transformer model
- [ ] Generate and store track embeddings on ingest
- [ ] Implement natural language playlist query (e.g. "chill morning vibes")
- [ ] Build query UI in the frontend

### Spotify Integration
- [ ] Integrate `librespot` for Spotify playback
- [ ] Implement Spotify authentication flow
- [ ] Map Spotify tracks to local CAS blobs where duplicates exist
- [ ] Surface Spotify tracks alongside local library in UI

### Developer Mode — Commit Graph
- [ ] Implement lazy-loaded visual commit history graph for playlists
- [ ] Allow playlist reversion to any prior commit
- [ ] Build developer mode toggle in settings

### Telemetry (Local Only)
- [ ] Track play counts per track in SQLite
- [ ] Track skip events per track in SQLite
- [ ] Build local stats view (most played, skip rate, listening history)

---

---

## Desktop UI — Branch `desktop-ui`

Implemented 2026-05-02 from Claude Design handoff (`/tmp/melomaniac/project/`). All code lives in `src/desktop/`; old mobile placeholder components in `src/components/` are untouched and serve as the future mobile UI base.

### What was built

| File | Description |
|---|---|
| `src/desktop/style.css` | Full design-system CSS — warm brown palette (`--bg-0` → `--bg-5`), accent/text/border tokens, all component classes |
| `src/desktop/data.ts` | Typed mock data — `Album`, `Track`, `Playlist`, `Commit` + chart data |
| `src/desktop/types.ts` | Shared `Tweaks` interface (avoids circular imports) |
| `src/desktop/DesktopApp.tsx` | Root app — all state, `useTweaks` hook, dynamic CSS variable updates on theme change |
| `components/TitleBar.tsx` | macOS traffic-light titlebar with drag region |
| `components/Sidebar.tsx` | Icon rail with animated tooltips, collapsible playlist tree, pinned playlists, folder popup, yt-dlp importer stub |
| `components/Carousel.tsx` | Custom coverflow — cubic ease-out animation, `requestAnimationFrame`, 3D tilt on hover with mouse-tracking shine |
| `components/PlaylistHeader.tsx` | Playlist name, version, git action buttons (Shuffle / Commit / Branch / Push / Pull), tab bar |
| `components/PlayerControls.tsx` | Play/pause/shuffle/loop, A·B loop mode with draggable markers on seek bar, volume slider |
| `components/TrackList.tsx` | 10-column grid, HTML5 drag-to-reorder with uncommitted-changes banner, dots context menu rendered as a fixed portal |
| `components/RightPanel.tsx` | AI vibe text → mock playlist generator, mini SVG bar/line charts, connections panel, AI Vibes preview |
| `components/CommitGraph.tsx` | SVG DAG with branch lane columns — both overlay modal and inline (History tab) variants |
| `components/BranchModal.tsx` | Branch creation with commit selector radio list |
| `components/SettingsModal.tsx` | Theme switcher, accent hue slider (live CSS variable), density pills, right-panel toggle, carousel size slider |
| `components/PlaylistSettingsPanel.tsx` | Per-playlist settings — upstream URL, fork/delete/save |
| `components/EditorView.tsx` | "Unimplemented" placeholder for the MP3 metadata editor |

### Known bugs (next session)

- `void hoveredRow` workaround in `TrackList.tsx` — row hover state is tracked but not yet used for anything visible; remove the suppression when hover actions are wired
- The seek bar in `PlayerControls` uses hardcoded `24:20` total duration — needs to be driven by actual track length
- `PlayerControls` track info shows `TRACKS[0]` unconditionally — should follow `activeTrackId`
- Rail git icon opens the commit graph modal but leaves `railItem` set to `'git'`; navigating away doesn't reset the highlighted rail icon correctly
- Right-panel collapse button points `›` the wrong way (should be `‹` when expanded)
- No Tailwind/DaisyUI migration yet — still using inline styles throughout; migration planned for a future session
- Audio not wired — all controls are visual only

### Next steps

1. Fix the known bugs above
2. Wire `PlayerControls` play/pause/seek/volume buttons to `invoke()` audio commands
3. Replace hardcoded mock data with real SQLite reads via `library_get_all` / `playlist_get_all`
4. Migrate component styles to Tailwind + DaisyUI for consistency with future mobile UI
5. Add platform check in `src/App.tsx` to route desktop vs. mobile UI at runtime

*Last updated: 2026-05-02. Desktop UI ported from Claude Design prototype, TypeScript clean, production build passing. No audio wired yet.*
