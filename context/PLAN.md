# Melomaniac — Development Plan

> Tasks are ordered by priority phase. Complete P0 fully before beginning P1.

---

## P0 — Core Engine (MVP)

### Tauri v2 Workspace
- [x] Initialise Tauri v2 project with Vite + React + TypeScript frontend
- [x] Upgrade all Tauri packages from RC to stable v2 (tauri 2.10.3, tauri-build 2.5.6, tauri-plugin-shell 2.3.5, @tauri-apps/cli/api 2.10.1)
- [x] Upgrade frontend toolchain (Vite 5→6, @vitejs/plugin-react 4→5, Swiper 11→12, 0 audit vulnerabilities)
- [x] Gitignore generated targets: `src-tauri/gen/apple`, `src-tauri/gen/android`, `src-tauri/gen/schemas`, `src-tauri/target`
- [ ] Configure workspace for iOS and Android compilation targets (requires Xcode — in progress)
- [ ] Verify a "Hello World" build runs on Desktop, iOS simulator, and Android emulator
- [ ] Set up project directory structure (`.melomaniac/objects/`, `src/`, `src-tauri/`)

### Native Audio Bridge ⚠️ (Highest Risk — Do First)
- [x] Set up `crates/audio` workspace crate (`melomaniac-audio`) inside `src-tauri/`
- [x] Define `AudioBridge` trait, `AudioSource` (`File` + uninhabitable `Stream` stub), `TrackMetadata`, `AudioEvent`, and `AudioError` in `crates/audio/src/lib.rs`
- [x] Implement desktop backend (`crates/audio/src/desktop.rs`) — dedicated audio thread, `MixerDeviceSink` + `Player` (rodio 0.22 API), `symphonia-all` codecs, atomic position tracking, volume persistence across loads
- [x] Wire `AudioState` into Tauri managed state; implement all seven Tauri commands in `src/audio.rs` (`audio_load`, `audio_play`, `audio_pause`, `audio_stop`, `audio_seek`, `audio_set_volume`, `audio_position`)
- [x] Spawn event-forwarding thread: `AudioEvent` → `AppHandle::emit("audio://event")` → frontend
- [ ] Integrate `tauri-plugin-native-audio` and `tauri-plugin-media`
- [ ] Implement AVPlayer bridge for iOS background audio
- [ ] Implement ExoPlayer / Media3 bridge for Android background audio
- [ ] Verify background audio persistence when app is minimised on iOS
- [ ] Verify background audio persistence when app is minimised on Android
- [ ] Implement lockscreen controls (play, pause, skip) on iOS
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
- [x] Verify end-to-end audio playback on Linux (`tests/audio/test.mp3` hardcoded in `App.tsx` useEffect — confirmed working, **remove before real wiring**)
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
- [ ] Implement carousel view for albums / playlists
- [ ] Refine info-dense tracklist layout
- [ ] Add artwork display in player and library views
- [ ] General visual polish pass

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

*Last updated: project planning phase. No external data is collected — all telemetry is stored locally per GPLv2 ethos.*
