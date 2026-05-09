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
- [x] Implement `std::process::Command` wrapper around `yt-dlp` binary (`src-tauri/src/downloader.rs`)
- [x] Support audio-only download with format selection — M4A via `--extract-audio --audio-format m4a --audio-quality 0`
- [x] Implement error handling for failed downloads — `download://error` events surfaced in UI
- [ ] Bundle or document yt-dlp binary update strategy for end users
- [x] Expose ingest command to frontend via Tauri invoke — `download_enqueue`, `download_queue`, `download_cancel`

### Content-Addressable Storage (CAS) Model
- [x] Implement `blake3` file hashing for ingested audio and image files (`crates/storage/src/cas.rs` — `CasStore::hash`)
- [x] Implement blob storage to `<app_data_dir>/objects/<xx>/<remaining-62>` with atomic write (`CasStore::write_blob`)
- [x] Implement deduplication check before writing a new blob (exists check in `write_blob`)
- [x] Define JSON Tree (playlist) manifest schema (`{ "tracks": [{ "hash", "ab_start_ms", "ab_end_ms" }] }` — committed as CAS blob via `branch_commit`)
- [x] Define and implement JSON Commit schema (tree_hash, parent, timestamp, device_id, message — `CommitRecord`)
- [x] Implement Commit read/write functions (`db.insert_commit`, `db.get_commit`, `db.get_commit_history`)
- [x] Set up SQLite database with `sqlx` (`crates/storage/src/db.rs` — WAL mode, foreign keys, migrations)
- [x] Implement SQLite schema for track metadata, plays/skips, playlists, branches, commits, commit_parents (migrations 0001–0008)
- [x] Implement indexer that reconciles SQLite against CAS on startup (`crates/storage/src/indexer.rs` — removes stale rows, logs orphan blobs)
- [x] Wire `StorageState` into Tauri app (`src-tauri/src/storage.rs` + `lib.rs`); expose all playlist/branch/commit commands
- [x] Write unit tests for storage commands — 18 passing (7 in `db.rs`, 11 in `storage.rs` covering `append_tracks_inner` and `merge_branches_inner`)

### Axum Self-Hosted Sync Server
- [ ] Scaffold Axum server project inside workspace
- [ ] Implement `/status` endpoint
- [ ] Implement `/pull` endpoint (serve missing commits/trees/blobs to client)
- [ ] Implement `/push` endpoint (receive commits/trees/blobs from client)
- [ ] Dockerize server with a minimal `Dockerfile` and `docker-compose.yml`
- [ ] Document self-hosting setup in README

### React Frontend Scaffolding
- [x] Set up Zustand store with slices for queue, playback state, library, and playlist (`src/store/`)
- [ ] Implement `requestAnimationFrame` progress bar loop via `useRef` (no React re-renders)
- [ ] Implement virtualized tracklist with `tanstack/react-virtual` (target: 10,000+ tracks)
- [x] Build player controls UI — play/pause, seek bar with real duration, volume slider, skip, shuffle, loop, A·B markers; all wired to Tauri invoke commands
- [x] Build library view wired to SQLite metadata via Tauri invoke — `library_get_all` populates tracklist and carousel with real tracks; artwork fetched via `track_get_artwork` (BLAKE3 CAS lookup)
- [x] Build playlist view wired to real backend — `playlist_get_all` sidebar, `playlist_get_tracks` populates tracklist and carousel, add/remove/reorder tracks all commit to CAS
- [x] Verify end-to-end audio playback on Desktop and iOS real device
- [x] Wire playback controls to audio invoke commands — `audio_play`, `audio_pause`, `audio_seek`, `audio_set_volume`, `track_play`; volume synced to backend on mount; backward seek fallback via decoder reload
- [x] Debug ingest replaced with `read_dir` loop scanning `tests/audio/` at startup — supports MP3, FLAC, OGG, WAV, M4A, AAC; idempotent
- [x] Wire yt-dlp ingest UI — Download modal in Library header; progress bars per item; live title from yt-dlp `before_dl:` hook; library auto-refreshes on completion
- [x] Carousel wired to active playlist — `playQueue` derives from `playlistTracks ?? trackOrder`; shuffle operates on the active source; queue resets when playlist/branch changes

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
- [x] Visual commit history graph for playlists — SVG DAG with lane layout, branch colours, cubic-bezier curves; inline (History tab) + full-screen overlay variants
- [x] Merge commits rendered as diamond nodes; source branch lines flow in their own colour up to the merge point, then target colour continues
- [x] Allow playlist reversion to any prior commit — `branch_revert_to` command + UI button in commit detail panel
- [x] Build developer mode toggle in settings

### Telemetry (Local Only)
- [ ] Track play counts per track in SQLite
- [ ] Track skip events per track in SQLite
- [ ] Build local stats view (most played, skip rate, listening history)

---

## Desktop UI — Branch `desktop-ui`

Implemented 2026-05-02 from Claude Design handoff (`/tmp/melomaniac/project/`). All code lives in `src/desktop/`; old mobile placeholder components in `src/components/` are untouched and serve as the future mobile UI base.

### Component inventory

| File | Description |
|---|---|
| `src/shared/themes.ts` | Central theme system — `NAMED_THEMES` (warm/cool/forest/violet), mutable `_custom` slot, `writeCustomHue()`, `applyTheme()` sets all CSS vars + DaisyUI v5 vars |
| `src/desktop/style.css` | Design-system CSS — fallback palette vars, layout classes, `.tl-row` grid, `.seek-track`, `.rail-tooltip`, `.styled-scroll`, animations |
| `src/main.css` | Tailwind v4 entry — `@import "tailwindcss"`, `@plugin "daisyui"`, `@theme {}` mapping `--color-mm-*` → runtime CSS vars |
| `src/desktop/data.ts` | Typed mock data (ALBUMS, fallback TRACKS, PLAYLISTS) + live converter functions `trackRecordToTrack`, `playlistRecordToPlaylist` |
| `src/desktop/types.ts` | `AppSettings` interface |
| `src/desktop/DesktopApp.tsx` | Root app — all state, `activeQueue = playlistTracks ?? trackOrder`, `playQueue` derives from `activeQueue`, shuffle/carousel/playback all playlist-aware |
| `components/TitleBar.tsx` | Custom titlebar with drag region and window controls |
| `components/Sidebar.tsx` | Icon rail with tooltips, collapsible playlist tree, pinned playlists, folder popup |
| `components/Carousel.tsx` | Coverflow — cubic ease-out animation, `requestAnimationFrame`, DaisyUI `hover-3d`, `ResizeObserver` for responsive width |
| `components/PlaylistHeader.tsx` | Playlist name, branch dropdown, Fork/Branch/Merge/Push/Pull buttons, tab bar |
| `components/PlayerControls.tsx` | Play/pause/shuffle/loop/queue buttons; A·B loop mode with draggable seek markers |
| `components/TrackList.tsx` | 10-column grid; mouse-event drag-to-reorder; uncommitted-changes banner; right-click context menu with "Remove from playlist" and "Add to playlist" |
| `components/RightPanel.tsx` | AI vibe text → mock playlist generator, mini SVG charts |
| `components/CommitGraph.tsx` | SVG DAG — branch lane columns, colour palette, merge diamonds, source-branch lines flow in own colour to the merge point; overlay + inline variants |
| `components/BranchModal.tsx` | New branch from current HEAD |
| `components/ForkPlaylistModal.tsx` | Fork with custom name; new name stamped into all branch trees immediately |
| `components/MergeBranchModal.tsx` | Source branch picker, union/intersection strategy toggle, live track-diff preview, commit message input |
| `components/PlaylistSettingsPanel.tsx` | Editable name with save button, two-step delete confirm, shows `forked_from` info |
| `components/SettingsModal.tsx` | Named theme pills + Custom pill; accent hue slider; density, right-panel toggle, carousel size slider |
| `components/EditorView.tsx` | MP3 metadata editor — title/artist/album fields, artwork replacement |

### Toolchain

- **Tailwind v4** — `@import "tailwindcss"` + `@tailwindcss/vite` plugin; CSS-first config via `@theme {}`
- **DaisyUI v5** — `@plugin "daisyui"`; `tabs-border`, flat native-desktop look; full oklch() vars
- **CSS cascade layers** — Tailwind v4 Preflight handles element resets inside `@layer base`

### Play queue / carousel ordering

- `activeQueue` — `useMemo`; equals `playlistTracks` when a playlist is active, otherwise `trackOrder` (full library). This is what the carousel renders and what playback draws from.
- `playQueue` — `activeQueue` unless shuffle is active, in which case it is a frozen Fisher-Yates shuffle of `activeQueue` created when shuffle is toggled on
- `carouselAlbums` — `playQueue.map(t => ({ ...ALBUMS[t.albumRef], artworkUrl: artworkUrls[t.hash] }))`
- `carouselIdx` — `playQueue.findIndex(t => t.id === activeTrackId)`, defaults to 0 if not found
- Switching playlist or branch resets `shuffledQueue` and `isShuffle` so stale queue doesn't carry over

### Commit message conventions (auto-generated)

| Operation | Message format |
|---|---|
| Add 1 track | `"Add: {title}"` |
| Add multiple tracks | `"Add tracks:\n• {title}\n• {title}\n…"` |
| Remove track | `"Remove: {title}"` |
| Reorder tracks | `"Reorder tracks"` |
| Set artwork | `"Set playlist artwork"` |
| Rename playlist | `"Rename: '{old}' → '{new}'"` |
| Fork playlist | `"Forked from {source} @ {short_hash}"` |
| Merge branch | `"Merge '{source}' into '{target}'"` |
| Revert to commit | `"Revert to {short_hash}"` |

### Unit tests — `src-tauri/src/storage.rs`

18 tests total (7 pre-existing in `crates/storage/src/db.rs`, 11 new in `src-tauri/src/storage.rs`):

**`append_tracks_inner`** (5 tests)
- `append_adds_new_tracks_and_commits` — basic append advances HEAD
- `append_noop_on_all_duplicates` — no commit when every hash already present
- `append_partial_dedup_only_adds_new` — only genuinely new hashes added
- `append_single_track_message` — generates `"Add: {title}"` message
- `append_multi_track_message_uses_bullets` — generates bulleted `"Add tracks:\n• …"` message

**`merge_branches_inner`** (6 tests)
- `merge_union_appends_source_unique_tracks` — source-only tracks appended to target
- `merge_union_no_duplicates_for_shared_tracks` — shared track appears exactly once
- `merge_intersection_keeps_only_shared_tracks` — non-shared tracks removed
- `merge_same_branch_is_error` — guard returns `Err` immediately
- `merge_produces_two_parent_commit` — DB records exactly 2 parents
- `merge_message_defaults_to_branch_names` — auto message `"Merge 'feat' into 'main'"`

### Debug-only dev fixtures

In debug builds all data lands in an isolated `dev/` subdirectory of the app data dir — it never touches the real production library.

- **Library**: every audio file in `tests/audio/` is ingested at startup (idempotent — same hash skips the write)
- **DevelopmentOnly playlist**: `dev_seed_dev_playlist` (called from `lib.rs`) destroys and recreates a "DevelopmentOnly" playlist on every launch, seeded with all test-audio tracks. History does not accumulate — it always starts clean. This is the fixture for exercising the carousel and playback UI. Never appears in production builds.

### Known bugs / remaining work

- Rail git icon: clicking the git rail icon while the CommitGraph overlay is open doesn't reset the highlighted rail icon when navigating away
- `forked_at_commit` field missing from TypeScript `PlaylistRecord` type in `src/desktop/data.ts`
- Status bar at the bottom of the app still shows a hardcoded commit hash (`4fa9b0`)

### Completed since 2026-05-04

- **Phase 1** (working playlists): all commands implemented and wired — `playlist_get_tracks`, `playlist_remove_track`, `playlist_reorder_tracks`, `playlist_delete`, `playlist_rename`, `playlist_set_artwork`, `playlist_get_artwork`; sidebar reads live data; new-playlist modal; artwork editor
- **Phase 2** (branching UI): branch switcher dropdown, `branch_delete`, `branch_rename`, `branch_revert_to`; commit detail panel with branch-from-here and revert actions
- **Phase 3** (merge UI): `MergeBranchModal` with source picker, union/intersection strategy, live track-diff preview; `branch_merge` Rust command; two-parent commits; diamond nodes in commit graph; source branch lines keep their colour up to the merge point
- **Fork name fix**: forked playlists no longer show the source name — a commit stamping the new name into all branch trees is written immediately after fork
- **Descriptive commit messages**: add operations emit `"Add: title"` or bulleted list; remove emits `"Remove: title"`; fork emits `"Forked from X @ hash"`
- **Toast notifications**: fork, delete, rename, remove-from-playlist, add-to-playlist, merge all surface a toast
- **No-op append guard**: `branch_append_tracks` returns current HEAD without writing a commit when all provided hashes already exist in the tree
- **CommitGraph colour fix**: merge commit diamonds use target branch colour; source branch line keeps its own colour all the way to the merge point, then only the target branch continues
- **Unit tests**: 11 new tests for `append_tracks_inner` and `merge_branches_inner`; extracted inner functions so logic is testable without Tauri state; `tempfile` added to dev-deps
- **Carousel wired to playlist**: `activeQueue = playlistTracks ?? trackOrder`; shuffle uses the correct source; queue resets on playlist/branch switch
- **DevelopmentOnly playlist**: debug fixture recreated fresh each launch with all test tracks

### Next steps

1. **Sublists (Phase 4)** — `playlist_add_include` / remove / pin / unpin commands; recursive resolver in `playlist_get_tracks`; "Includes" section in Playlist Settings
2. **Fix `forked_at_commit` in TS types** — add to `PlaylistRecord` interface in `src/desktop/data.ts`
3. **Fix status bar** — replace hardcoded `4fa9b0` with live `activePlaylist` branch HEAD short hash
4. **Android audio bridge** — ExoPlayer / Media3 implementation
5. **Platform routing** — `src/App.tsx` should detect desktop vs. mobile at runtime

*Last updated: 2026-05-08.*
