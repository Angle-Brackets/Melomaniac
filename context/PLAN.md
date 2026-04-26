# Melomaniac — Development Plan

> Tasks are ordered by priority phase. Complete P0 fully before beginning P1.

---

## P0 — Core Engine (MVP)

### Tauri v2 Workspace
- [ ] Initialise Tauri v2 project with Vite + React + TypeScript frontend
- [ ] Configure workspace for iOS and Android compilation targets
- [ ] Verify a "Hello World" build runs on Desktop, iOS simulator, and Android emulator
- [ ] Set up project directory structure (`.melomaniac/objects/`, `src/`, `src-tauri/`)

### Native Audio Bridge ⚠️ (Highest Risk — Do First)
- [ ] Integrate `tauri-plugin-native-audio` and `tauri-plugin-media`
- [ ] Implement AVPlayer bridge for iOS background audio
- [ ] Implement ExoPlayer / Media3 bridge for Android background audio
- [ ] Verify background audio persistence when app is minimised on iOS
- [ ] Verify background audio persistence when app is minimised on Android
- [ ] Implement lockscreen controls (play, pause, skip) on iOS
- [ ] Implement lockscreen controls (play, pause, skip) on Android
- [ ] Expose `play`, `pause`, `seek`, `stop` Tauri commands to frontend

### yt-dlp Ingestion Wrapper
- [ ] Implement `std::process::Command` wrapper around `yt-dlp` binary
- [ ] Support audio-only download with format selection (FLAC/MP3)
- [ ] Implement error handling for failed or changed yt-dlp formats
- [ ] Bundle or document yt-dlp binary update strategy for end users
- [ ] Expose ingest command to frontend via Tauri invoke

### Content-Addressable Storage (CAS) Model
- [ ] Implement `blake3` file hashing for ingested audio and image files
- [ ] Implement blob storage to `.melomaniac/objects/<xx>/<remaining-hash>`
- [ ] Implement deduplication check before writing a new blob
- [ ] Define and implement JSON Tree (playlist) manifest schema
- [ ] Implement Tree read/write functions
- [ ] Define and implement JSON Commit schema (tree hash, parent hash, timestamp, device ID)
- [ ] Implement Commit read/write functions
- [ ] Set up SQLite database with `sqlx` or `rusqlite`
- [ ] Implement SQLite schema for track metadata index and play metrics
- [ ] Implement indexer that populates SQLite from CAS objects on startup

### Axum Self-Hosted Sync Server
- [ ] Scaffold Axum server project inside workspace
- [ ] Implement `/status` endpoint
- [ ] Implement `/pull` endpoint (serve missing commits/trees/blobs to client)
- [ ] Implement `/push` endpoint (receive commits/trees/blobs from client)
- [ ] Dockerize server with a minimal `Dockerfile` and `docker-compose.yml`
- [ ] Document self-hosting setup in README

### React Frontend Scaffolding
- [ ] Set up Zustand store with slices for queue, playback state, and library
- [ ] Implement `requestAnimationFrame` progress bar loop via `useRef` (no React re-renders)
- [ ] Implement virtualized tracklist with `tanstack/react-virtual` (target: 10,000+ tracks)
- [ ] Build player controls UI (play, pause, seek, skip, volume)
- [ ] Build library view wired to SQLite metadata via Tauri invoke
- [ ] Build basic playlist view rendering Tree manifest tracks
- [ ] Wire frontend playback controls to native audio bridge Tauri commands
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
