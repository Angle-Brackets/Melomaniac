# AGENTS.md

Guidance for AI agents developing Melomaniac. Read `CLAUDE.md` first for commands and current architecture, then use this file for roadmap context and implementation rules.

## Agent Workflow Rule

After successfully completing any task, **always update `context/PLAN.md`**:
- Mark finished items with `[x]`
- Add new items for any work done that wasn't already listed
- Update wording if the approach differed from the original description

Do not update PLAN.md for partial or failed work — only on verified completion.

---

## What This App Is

Melomaniac is a **cross-platform desktop + mobile music player** (macOS, Windows, Linux, iOS, Android) built on Tauri v2 + React/TypeScript. Its distinguishing features are:

- **yt-dlp ingestion** — download audio from URLs into a local library
- **Content-Addressable Storage (CAS)** — files stored by BLAKE3 hash under `.melomaniac/objects/`
- **Git-like playlist versioning** — playlists are JSON Tree manifests linked by Commit objects (tree hash, parent hash, timestamp, device ID)
- **Self-hosted sync server** — Axum HTTP server; P2P LAN sync via QUIC (quinn) and mDNS discovery is a P1 goal
- **All telemetry is local only** — no external data collection

---

## Priority Phases

### P0 — Core Engine (MVP) — work here first
All P0 tasks must be complete before starting P1.

**Native Audio Bridge** (highest risk — tackle first within P0)
- Integrate `tauri-plugin-native-audio` and `tauri-plugin-media`
- AVPlayer bridge for iOS background audio; ExoPlayer/Media3 for Android
- Lockscreen controls (play, pause, skip) on both platforms
- Expose `play`, `pause`, `seek`, `stop` as Tauri commands

**yt-dlp Ingestion**
- Rust `std::process::Command` wrapper around the `yt-dlp` binary
- Audio-only download with FLAC/MP3 format selection
- Expose ingest command to frontend via `invoke()`

**CAS Storage Model** ✓ complete
- `crates/storage` (`melomaniac-storage`) — Tauri-free, independently tested
- `CasStore`: BLAKE3 → `<app_data_dir>/objects/<xx>/<remaining-62>`, atomic write, dedup
- `Database`: sqlx SQLite pool, WAL + foreign keys, 4 migrations (tracks, plays/skips, playlists/branches, commits/commit_parents)
- `Indexer`: startup reconciliation — removes stale DB rows, logs orphan blobs
- `StorageState` managed by Tauri; 7 commands in `src-tauri/src/storage.rs`

**Axum Sync Server**
- `/status`, `/pull`, `/push` endpoints
- Dockerized with `Dockerfile` + `docker-compose.yml`

**React Frontend**
- Zustand store implemented at `src/store/` — see store slice summary in Architectural Constraints
- Progress bar via `requestAnimationFrame` + `useRef` — **no React state re-renders** for the seek position
- Virtualized tracklist with `tanstack/react-virtual` (must handle 10,000+ tracks)
- Wire all controls to native audio bridge Tauri commands

### P1 — Beta / Daily Driver
- Smart Loop: A/B timestamp metadata in Tree manifest + seek logic in bridges
- Metadata extraction: `id3` crate → SQLite; handle missing tags with fallbacks
- P2P Sync: mDNS discovery → QUIC transfer → Automerge CRDTs for conflict resolution; fall back to Axum when no LAN peer
- UI polish: album/playlist carousel, artwork display, info-dense tracklist

### P2 — Power User & AI
- Semantic playlist generation: `sqlite-vector-rs` + local sentence-transformer + NL query UI
- Spotify via `librespot` — map Spotify tracks to local CAS blobs where duplicates exist
- Developer mode: lazy-loaded visual commit graph, playlist reversion
- Local telemetry: play counts and skip events in SQLite, stats view

---

## Architectural Constraints

| Concern | Rule |
|---|---|
| Audio progress bar | Use `requestAnimationFrame` + `useRef`. Never put seek position in React state — it causes 60 fps re-renders of the whole tree. |
| Large track lists | Always use `tanstack/react-virtual`. Never render the full list into the DOM. |
| Tauri commands | Register every new Rust command in `src-tauri/src/lib.rs` with `#[tauri::command]` and add it to `tauri::generate_handler![]`. |
| CAS writes | Always BLAKE3-hash first, check for existing blob, skip write if duplicate. |
| Sync conflicts | Use Automerge CRDTs for playlist divergence. Do not implement custom merge logic. |
| Telemetry | Store only in local SQLite. No network calls for analytics. |
| Tauri dev CWD | The Tauri binary runs with `src-tauri/` as its working directory in dev mode. File paths passed from the frontend must be relative to `src-tauri/` (e.g. `"../tests/audio/test.mp3"` to reach the project root) or absolute. This will not be an issue once `audio_load` resolves hashes via CAS. |
| TypeScript enums | Use `enum` with string values (e.g. `Off = 'Off'`), not `const enum`. Vite's `isolatedModules` mode breaks `const enum` across files. String values also survive JSON round-trips without a lookup table. |
| Zustand store | All global state lives in `src/store/`. Slices: `playbackSlice`, `queueSlice`, `librarySlice`, `playlistSlice`. Import via `useStore` from `src/store/index.ts`. If a slice needs to read another slice's state, widen its `StateCreator` generic to `StoreState` and use `import type { StoreState } from './index'` to avoid a circular runtime dependency. |
| Shuffle queue | Both `ShuffleMode.Random` and `ShuffleMode.Smart` pre-generate `lookahead` (default 20) upcoming hashes into `shuffledQueue` so the UI always has tracks to display. `Smart` uses a full Fisher-Yates permutation (no repeats per cycle); `Random` samples with `shuffleHistory` dedup. Never pick the next track lazily — always maintain the lookahead window. |

---

## Data Model Reference

```
.melomaniac/
  objects/
    <xx>/              # first 2 hex chars of BLAKE3 hash
      <remaining-hash> # raw audio or image blob

Commit JSON:
  { tree: "<tree-hash>", parent: "<commit-hash|null>", timestamp: <unix>, device_id: "<uuid>" }

Tree JSON (playlist):
  { tracks: [{ blob: "<hash>", ab_start?: <ms>, ab_end?: <ms> }] }

SQLite tables:
  tracks  (hash, title, artist, album, artwork_hash, duration_ms)
  plays   (hash, played_at)
  skips   (hash, skipped_at)
```

---

## Tech Stack Quick Reference

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 |
| Mobile targets | iOS (AVPlayer), Android (ExoPlayer/Media3) |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS + DaisyUI |
| Icons | react-icons |
| Carousel | Swiper (coverflow effect) |
| State | Zustand 5 (`src/store/` — 4 slices wired) |
| Virtual list | tanstack/react-virtual (not yet installed) |
| Rust audio | tauri-plugin-native-audio, tauri-plugin-media |
| Rust hashing | blake3 |
| Rust DB | sqlx 0.8 + SQLite (`melomaniac-storage` crate at `crates/storage/`) |
| Rust HTTP server | Axum |
| Rust P2P | quinn (QUIC), mdns-sd |
| Rust CRDT | automerge |
| Rust tag parsing | id3 crate |
| Rust serialization | serde + serde_json |
| Audio ingestion | yt-dlp (external binary, called via std::process::Command) |
