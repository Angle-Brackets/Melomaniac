# Melomaniac — Roadmap

## Overview

Melomaniac is a cross-platform music player built on **Tauri 2 + React/TypeScript + Rust**, targeting desktop (macOS, Linux, Windows) and iOS. Its defining characteristic is a **git-style versioned playlist system**: playlists are content-addressed repositories with commits, branches, forks, and 3-way DAG merges. The library is stored as BLAKE3-hashed blobs in a CAS (content-addressed store), making every track, artwork, and playlist snapshot deduplicated and sync-safe.

---

## Shipped — v1.0.0-alpha

### Audio & Playback
- [x] Desktop audio playback — rodio 0.22, dedicated OS audio thread (required because `cpal::Stream` is `!Send` on macOS), atomic position tracking via `Arc<AtomicU64>`
- [x] iOS audio playback — custom Swift FFI bridge to AVFoundation (`AVAudioPlayer`), background audio session, lock screen controls via `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter`
- [x] Supported formats: MP3, FLAC, OGG/Vorbis, WAV, M4A/AAC, ALAC, Opus
- [x] Shuffle modes: **Random** (Fisher-Yates) and **Smart** (artist-spread weighted, avoids back-to-back same artist)
- [x] **AB loop** — per-track A/B timestamps persisted to `localStorage`, survives restarts
- [x] Loop modes: off / one / AB
- [x] Queue management with drag-to-reorder
- [x] Seek bar with live position (ref-based, no React re-renders)
- [x] Volume control

### Library & Storage
- [x] **Content-addressed store (CAS)** — BLAKE3 hashing, `objects/<xx>/<remaining-62>` layout, atomic writes, automatic deduplication
- [x] **SQLite database** — tracks, artwork, plays, skips, playlists, branches, commits, commit parents; WAL mode; foreign keys
- [x] **yt-dlp ingestion** — download audio from any URL directly into CAS with metadata extraction; background download queue with progress ring
- [x] **Metadata editor** — read/write MP3/FLAC/OGG tags via `lofty`; bulk edit support; artwork library; CAS-aware (edits produce new blob → new commit on all affected branches, propagating to peers automatically)
- [x] Track artwork extraction at ingest time; artwork stored as separate CAS blob, shared across albums
- [x] Listening statistics — play counts, skip counts, per-track and per-session; virtual stats list with artwork thumbnails
- [x] Auto-select last playlist on startup; default to first playlist when none saved

### Playlist Versioning
- [x] **Commits** — every playlist mutation (add/remove/reorder/metadata edit) creates a commit with author name, timestamp, and parent hash
- [x] **Branches** — playlists have multiple named branches; switch and create branches inline
- [x] **Fork** — fork a playlist into a new independent playlist at any commit
- [x] **3-way DAG merge** — `diff_trees` computes set of changes; fast-forward when no divergence, auto-merge when no conflicts, `ConflictChunk` for true conflicts
- [x] **Conflict resolution UI** — desktop amber "Conflict" button on playlist header; mobile banner; per-track diff viewer with ScrollText track names and enter/exit animations
- [x] **Commit graph** — visual history of branches and commits (desktop)
- [x] Commit author configurable in settings (shown in history)

### LAN Sync
- [x] **mDNS-SD discovery** — desktop via `mdns-sd` crate; iOS via NWBrowser/NWListener Swift FFI (`_melomaniac._tcp.local.`)
- [x] **Axum HTTP server** (port 7700) — endpoints: `/ping`, `/manifest`, `/hashes`, `/tracks`, `/blob/:hash`, `/commits/:id/:branch`, `/pair`
- [x] **Ed25519 signed auth** — timestamp-based challenge prevents replay attacks
- [x] **QR pairing** — desktop shows QR code; iOS scans via camera + barcode scanner plugin; keys exchanged and persisted to trust list
- [x] **Auto-sync** — continuous HEAD-diff polling; silently fast-forwards shared branches when a peer comes online
- [x] **Manual sync** — "Sync now" from settings panel fetches full manifest and syncs all changed branches
- [x] Sync transfers both audio blobs and artwork blobs
- [x] Download progress ring per track
- [x] Peer latency display (ms)
- [x] Known device management (view, remove)

### Desktop UI
- [x] Three-column layout: sidebar rail + main panel + right panel (queue / info)
- [x] Sidebar rail with tooltip navigation: Playlists, Library, History, Commit Graph, Editor, Discover (placeholder)
- [x] Playlist sidebar with folders, pinning, drag-to-reorder, conflict badges
- [x] Coverflow album carousel
- [x] DaisyUI + Tailwind theming
- [x] Custom titlebar (frameless window)
- [x] **Discord Rich Presence** — shows now-playing track and artist in Discord status

### Mobile UI (iOS)
- [x] Tab navigation: Library, Discover (placeholder), Now Playing, Settings
- [x] Coverflow carousel with gesture navigation
- [x] `PlaylistDetail` slide overlay with branch picker, fork, merge, edit sheets
- [x] Swipe-to-delete tracks with vertical-scroll cancellation
- [x] Pull-to-refresh
- [x] `MMSheet` bottom sheets with swipe-to-dismiss (full header zone as swipe target)
- [x] Android back button / swipe-back gesture support via History API
- [x] In-app browser via `SFSafariViewController` for external links

### Theming & Appearance
- [x] Named themes: Warm, Cool, Dark
- [x] Custom theme with accent hue slider (oklch)
- [x] Track list density: compact / normal / relaxed
- [x] Carousel card size slider
- [x] Settings persisted to `localStorage`

---

## Shipped — v1.0.1

### Audio & Playback
- [x] Shuffle modes: **Weighted** (play-count weighted, prefers less-played tracks) and **Discovery** (deprioritises recently played tracks) — two new modes beyond Random + Smart
- [x] Long-press radial menu on mobile shuffle button to select shuffle mode in one gesture
- [x] **AVAudioSession interruption handling** — music resumes automatically when another audio source (phone call, Siri, video) ends; respects iOS `shouldResume` flag

### Theming & Appearance
- [x] **Privacy Mode** — replaces album art with an accent-colored gradient overlay in the UI; withholds artwork from iOS lock screen/Control Centre
- [x] Theme accent colors now propagate immediately to all UI elements when the theme is changed

### Desktop UI
- [x] In-app auto-update with progress bar in Settings (no manual download needed)

### Mobile UI (iOS)
- [x] Secondary icon buttons (heart, shuffle, loop) fill their icon when active
- [x] Shuffle and heart icons are theme-colored (not tied to album art accent)
- [x] Long-press radial shuffle-mode picker
- [x] Queue panel has rounded top corners
- [x] Artist text is always white in Now Playing
- [x] Player tab glow respects active theme color

---

## In Progress

- [ ] **Discover tab** — AI-powered music discovery; UI placeholder (greyed out) exists on both desktop and mobile; backend not yet started

---

## Planned

### Near-term
- [ ] **Track export** — export a CAS blob back to the filesystem / iOS Files app via document picker (`library_export_track`)
- [ ] **Android support** — audio bridge via ExoPlayer/Media3; sync bridge via NSD (Network Service Discovery)
- [ ] **Playlist creation on mobile** — `+` button currently disabled
- [ ] **Automatic Playlist Metadata Generation** - Either using AI or by analyzing the audio content and generating a unique audial fingerprint

### Medium-term
- [ ] **AI & Metrics panel** (desktop right panel) — currently a placeholder toggle; planned: local embeddings, listening pattern analysis, smart playlist suggestions
- [ ] **Discover / AI music discovery** — natural language playlist queries, semantic track similarity, local sentence-transformer embeddings
- [ ] **Cloud sync** — sync beyond LAN; self-hosted Axum server option

### Long-term / Exploratory
- [ ] **Lyrics** — local LRC file support and/or online fetch
- [ ] **Spotify via librespot** — local playback with CAS mapping for overlapping tracks
- [ ] **Smart playlist rules** — auto-populated playlists based on stats, tags, or embeddings

---

## Out of Scope

- Streaming subscriptions (this is a local-first player)
- Telemetry or any external data collection (all data stays on-device or on your own LAN)
- DRM-protected content

---

## Architecture Note: Metadata Edits Produce Commits (Intentional)

When a track's metadata is edited, the CAS blob changes bytes → new BLAKE3 hash. `patch_trees_parallel` rewrites every branch tree referencing the old hash and creates a new commit per affected branch. This is correct: the new commit is what makes the change visible to peers during sync — without it, syncing devices would see no HEAD change and skip the branch. Metadata edits propagate to all users through the normal sync flow for free.
