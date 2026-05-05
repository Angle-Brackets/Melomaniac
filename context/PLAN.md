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
- [x] Implement desktop backend (`crates/audio/src/desktop.rs`) — dedicated audio thread, `MixerDeviceSink` + `Player` (rodio 0.22 API), `symphonia-all` codecs (MP3, FLAC, OGG/Vorbis, WAV, M4A/AAC, ALAC, Opus, MKV/WebM), atomic position tracking, volume persistence across loads
- [x] Wire `AudioState` into Tauri managed state; implement all seven Tauri commands in `src/audio.rs` (`audio_load`, `audio_play`, `audio_pause`, `audio_stop`, `audio_seek`, `audio_set_volume`, `audio_position`)
- [x] Spawn event-forwarding thread: `AudioEvent` → `AppHandle::emit("audio://event")` → frontend
- [x] Create stub `IosBridge` and update `lib.rs` feature flags to enable iOS compilation
- [x] Implement AVAudioPlayer bridge for iOS background audio — Swift FFI via `@_cdecl`, `swift-rs` SPM package at `crates/audio/ios/`; `IosBridge` in `crates/audio/src/ios.rs`; `UIBackgroundModes: audio` in `src-tauri/Info.ios.plist`
- [x] Verify background audio persistence when app is minimised on iOS (confirmed on device)
- [x] Implement lockscreen/Control Centre Now Playing widget — `MPNowPlayingInfoCenter` updated every 250 ms + immediately on play; `MPRemoteCommandCenter` (play, pause, next, prev, toggle) with token retention; `RemotePlay/RemotePause/RemoteNextTrack/RemotePreviousTrack/RemoteTogglePlayPause` variants added to `AudioEvent`
- [x] Verify Now Playing widget appears on real device (simulator cannot show it — test when device controls are wired)
- [ ] Implement ExoPlayer / Media3 bridge for Android background audio
- [ ] Verify background audio persistence when app is minimised on Android
- [ ] Implement lockscreen controls (play, pause, skip) on Android
- [x] Expose `play`, `pause`, `seek`, `stop`, `audio_load`, `audio_set_volume`, `audio_position` Tauri commands to frontend
- [x] Fix rodio Symphonia decoder RandomAccessNotSupported error on backward seek by implementing decoder reload fallback

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
- [x] Build player controls UI — play/pause, seek bar with real duration, volume slider, skip, shuffle, loop, A·B markers; all wired to Tauri invoke commands
- [x] Build library view wired to SQLite metadata via Tauri invoke — `library_get_all` populates tracklist and carousel with real tracks; artwork fetched via `track_get_artwork` (BLAKE3 CAS lookup)
- [ ] Build basic playlist view rendering Tree manifest tracks
- [x] Verify end-to-end audio playback on Desktop and iOS real device
- [x] Wire playback controls to audio invoke commands — `audio_play`, `audio_pause`, `audio_seek`, `audio_set_volume`, `track_play`; volume synced to backend on mount; backward seek fallback via decoder reload
- [x] Debug ingest replaced with `read_dir` loop scanning `tests/audio/` at startup — supports MP3, FLAC, OGG, WAV, M4A, AAC; idempotent
- [ ] Wire yt-dlp ingest UI (URL input → download → library refresh)

---

## P1 — Beta / Daily Driver

### Smart Loop (A/B Timestamps)
- [ ] Extend Tree manifest schema to support per-track A/B timestamp metadata
- [ ] Implement A/B seek logic in the native audio bridge (iOS)
- [ ] Implement A/B seek logic in the native audio bridge (Android)
- [x] Build A/B loop UI controls in the player view — draggable A/B markers on seek bar, per-track state saved in `trackAbPoints`

### Metadata Extraction
- [x] Integrate `id3` crate for reading tags from ingested MP3/FLAC files
- [x] Populate SQLite index with extracted title, artist, album, artwork hash, duration — symphonia probes duration when TLEN frame absent; artwork extracted and stored in CAS; DB patched on re-ingest when fields are missing
- [x] Handle missing or malformed tags gracefully with fallback values
- [x] Display extracted metadata in tracklist and player UI — title, artist, album, duration, artwork all live from SQLite/CAS

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
- [x] General visual polish pass — DaisyUI v5 migration, theme centralization, responsive carousel, mouse drag-reorder, play queue ordering
- [x] Add F12 performance toggle for CPU and RAM usage via `sysinfo` integration

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

### Component inventory

| File | Description |
|---|---|
| `src/shared/themes.ts` | Central theme system — `NAMED_THEMES` (warm/cool/forest/violet), mutable `_custom` slot, `writeCustomHue()`, `applyTheme()` sets all CSS vars + DaisyUI v5 vars |
| `src/desktop/style.css` | Design-system CSS — fallback palette vars, layout classes, `.tl-row` grid, `.seek-track`, `.rail-tooltip`, `.styled-scroll`, animations; no hover-3d polyfill (native DaisyUI v5) |
| `src/main.css` | Tailwind v4 entry — `@import "tailwindcss"`, `@plugin "daisyui"`, `@theme {}` mapping `--color-mm-*` → runtime CSS vars |
| `src/desktop/data.ts` | Typed mock data — `Album`, `Track`, `Playlist`, `Commit` + chart data |
| `src/desktop/types.ts` | `AppSettings` interface; imports `ThemeName` from `src/shared/themes` |
| `src/desktop/DesktopApp.tsx` | Root app — all state, `useMemo` play-queue/carousel derivation, `handleShuffle` builds a frozen shuffled queue, `handleUpdateSetting` intercepts accent-hue changes to write the custom theme slot |
| `components/TitleBar.tsx` | Custom titlebar with drag region and window controls |
| `components/Sidebar.tsx` | Icon rail with tooltips, collapsible playlist tree, pinned playlists, folder popup, yt-dlp importer stub |
| `components/Carousel.tsx` | Coverflow — cubic ease-out animation, `requestAnimationFrame`, DaisyUI `hover-3d`, `ResizeObserver` for responsive width, `size` prop drives card px and `halfVisible` cutoff |
| `components/PlaylistHeader.tsx` | Playlist name, version, git action buttons, tab bar (`tabs-border` DaisyUI v5) |
| `components/PlayerControls.tsx` | Play/pause/shuffle/loop/queue buttons; play button is an explicit 44 px circle overriding DaisyUI min-height; A·B loop mode with draggable seek markers |
| `components/TrackList.tsx` | 10-column grid; mouse-event drag-to-reorder (replaces broken HTML5 DnD); `window` mousemove/mouseup listeners scoped via `useEffect` on `dragIdx`; `dropIdxRef` for synchronous mouseup access; uncommitted-changes banner; fixed portal context menu |
| `components/RightPanel.tsx` | AI vibe text → mock playlist generator, mini SVG charts, connections panel |
| `components/CommitGraph.tsx` | SVG DAG — branch lane columns, overlay modal and inline (History tab) variants; Tailwind/mm-* classes |
| `components/BranchModal.tsx` | Branch creation with commit selector |
| `components/SettingsModal.tsx` | Named theme pills (warm/cool/forest/violet) + always-visible Custom pill; accent hue slider writes to custom slot; density, right-panel toggle, carousel size slider |
| `components/PlaylistSettingsPanel.tsx` | Per-playlist settings — upstream URL, fork/delete/save |
| `components/EditorView.tsx` | Placeholder for the MP3 metadata editor |

### Toolchain

- **Tailwind v4** — `@import "tailwindcss"` + `@tailwindcss/vite` plugin; `tailwind.config.js` deleted; CSS-first config via `@theme {}`
- **DaisyUI v5** — `@plugin "daisyui"`; class renames: `input-bordered` → `input`, `tabs-bordered` → `tabs-border`; `--depth: 0` / `--noise: 0` for flat native-desktop look; `hover-3d` native (polyfill removed); full oklch() vars (`--color-primary`, `--color-base-100`, etc.)
- **CSS cascade layers** — no unlayered `* { padding:0 }` reset (would beat all `@layer daisyui.*` component styles); Tailwind v4 Preflight handles element resets inside `@layer base`

### Play queue / carousel ordering

- `playQueue` — `useMemo`; equals `trackOrder` unless shuffle is active, in which case it's a frozen Fisher-Yates shuffle created when the user enables shuffle
- `carouselAlbums` — `playQueue.map(t => ALBUMS[t.albumRef])` — one card per track in play order
- `carouselIdx` — `playQueue.findIndex(t => t.id === activeTrackId)` — always points at the active track
- Enabling shuffle: `shuffledQueue` state is set to a shuffled copy of `trackOrder`; disabling clears it
- Manual drag-reorder clears `shuffledQueue` and turns off shuffle (user redefined the canonical order)
- Carousel uses `key={i}` (array position) instead of `album.id` to avoid duplicate-key warnings when multiple tracks share the same album

### Known bugs / remaining work

- Rail git icon opens the commit graph modal but doesn't reset the highlighted rail icon when navigating away
- Tracklist still uses mock `TRACKS` data for ordering (real library loaded but not committed to `trackOrder` on shuffle/commit)
- Playlist view not yet wired to real SQLite `playlist_get_all` / Tree manifest data
- `track_ingest_files` Tauri command exists but no UI to invoke it — users can only ingest via `tests/audio/` debug loop

### Next steps

1. Replace hardcoded `TRACKS`/`PLAYLISTS` mock data with live `library_get_all` / `playlist_get_all` reads
2. Add platform check in `src/App.tsx` to route desktop vs. mobile UI at runtime
3. Wire yt-dlp ingest UI in sidebar importer stub

*Last updated: 2026-05-04. Audio fully wired (play/pause/seek/volume/backward seek). Real track metadata and artwork from SQLite/CAS. Resizable sidebar, right panel, and carousel/tracklist split via `ResizeHandle`. Carousel hover-3d on center 3 cards only. All known audio and UI bugs from previous session resolved.*
