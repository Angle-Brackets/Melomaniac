# Melomaniac

[![CI](https://github.com/Angle-Brackets/Melomaniac/actions/workflows/ci.yml/badge.svg)](https://github.com/Angle-Brackets/Melomaniac/actions/workflows/ci.yml)

A cross-platform desktop music player built with **Tauri 2** + **React / TypeScript**, designed around a git-style content-addressable library — every track, playlist snapshot, and artwork is a BLAKE3-hashed blob. Playlists are repositories. Branches are subplaylists. Forks are forks.

---

## Alpha 0.0.1 Roadmap

### Core Engine

- [x] **Desktop audio playback** (Linux · macOS · Windows) — rodio 0.22 + symphonia (`symphonia-all`), dedicated audio thread, atomic position tracking; supported formats: MP3, FLAC, OGG/Vorbis, WAV, M4A/AAC, ALAC, Opus, MKV/WebM
- [x] **Content-addressable storage (CAS)** — BLAKE3 hashing, `objects/<xx>/<remaining-62>` layout, atomic blob writes, deduplication
- [x] **SQLite library database** — tracks, plays/skips, playlists, branches, commits, commit parents; WAL mode + foreign keys; migrations via sqlx
- [x] **Git-style playlist versioning** — playlists as repositories, branches as subplaylists, fork support, commit history walk
- [x] **Zustand state store** — playback, queue, library, and playlist slices; ShuffleMode (Off / Random / Smart with Fisher-Yates lookahead); RepeatMode; optimistic favorite toggling
- [ ] **File ingest** — import local audio files into CAS, extract metadata tags via symphonia/id3
- [ ] **yt-dlp download ingest** — download from URL directly into CAS + metadata
- [ ] **Library UI** — browse tracks, toggle favorite, search and filter
- [ ] **Playback controls** — play/pause, seek bar, volume, skip, shuffle, repeat wired to Tauri commands
- [ ] **Playlist UI** — create, fork, browse tracks on a branch

### Platform

- [x] Linux (tested)
- [ ] macOS (audio architecture ready, untested)
- [ ] Windows (audio architecture ready, untested)
- [ ] iOS (AVPlayer bridge — P1)
- [ ] Android (ExoPlayer / Media3 bridge — P1)

---

## Architecture

```
Frontend (React + TypeScript + Zustand)
    │  invoke() / listen()
    ▼
Tauri command layer  (src-tauri/src/)
    ├── audio.rs     — 7 playback commands
    └── storage.rs   — 7 library/playlist commands
    │
    ├── crates/audio/    (melomaniac-audio)
    │     AudioBridge trait → DesktopBridge (rodio + symphonia)
    │
    └── crates/storage/  (melomaniac-storage)
          CasStore  — BLAKE3, blob read/write
          Database  — sqlx SQLite pool, migrations, CRUD
          Indexer   — startup reconciliation
```

Audio events flow back via `AppHandle::emit("audio://event")` → Tauri → frontend listener.

Storage lives at the platform `app_data_dir`:

| Platform | Path |
|---|---|
| Linux   | `~/.local/share/melomaniac/` |
| macOS   | `~/Library/Application Support/com.melomaniac.app/` |
| Windows | `%APPDATA%\melomaniac\` |

---

## Development

```bash
# Frontend dev server only (http://localhost:1420)
npm run dev

# Full Tauri desktop app in dev mode
npm run tauri dev

# TypeScript type-check + production build
npm run build

# Run all tests
npm test                                        # TypeScript (Vitest)
cd src-tauri && cargo test -p melomaniac-storage -p melomaniac-audio
```

**Audio device tests** (5 tests) require a real or virtual audio output and are skipped by default. Run locally with:

```bash
cd src-tauri && cargo test -p melomaniac-audio -- --include-ignored
```

---

## Planned (Post-Alpha)

- **Smart Loop** — per-track A/B timestamps stored in the tree manifest
- **LAN P2P sync** — mDNS device discovery → QUIC transfer → Automerge CRDTs for offline conflict resolution
- **Self-hosted sync server** — Axum `/pull` + `/push` endpoints, Dockerized
- **Semantic playlist generation** — local sentence-transformer embeddings + natural language queries
- **Spotify via librespot** — local playback, tracks mapped to CAS blobs where they overlap
- **Commit graph UI** — visual playlist history, revert to any prior snapshot
