# Melomaniac — Editor & Downloader

The Editor page covers two distinct concerns unified under one view:
1. **Metadata editor** — read and rewrite tags on any audio file (CAS library or raw filesystem)
2. **Downloader** — pull audio from external sources (yt-dlp for YouTube / SoundCloud / Bandcamp; Spotify deferred to P2 via librespot)

---

## Platform behaviour

| Feature | Desktop | iOS / Mobile |
|---|---|---|
| Metadata editor (library tracks) | ✅ | ✅ |
| Metadata editor (filesystem files) | ✅ | ✗ — no accessible FS |
| File browser | ✅ | ✗ |
| Downloader tab | ✅ | ✗ — `std::process::Command` forbidden in App Store sandbox |
| "Get more tracks" prompt | ✗ | ✅ — directs user to sync from desktop via LAN/Axum |

On mobile the page renders only the metadata editor for library tracks. The file browser and downloader tabs are not rendered.

---

## Page layout (desktop)

```
┌─────────────────────────────────────────────────────────────┐  ← ~40% height
│  [Artwork 128×128]  filename.mp3  [MP3]  [Save] [Revert] [Ingest to Library] │
│                                                             │
│  Title ____________  Artist ____________  Album ___________│
│  Album Artist ______  Year ____  Track # ___  Disc # ___   │
│  Genre ____________  BPM ____   Composer _______________   │
│  Comment ___________________________________________________│
│  Lyrics ____________________________________________________│
│  (large textarea)                                           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐  ← ~60% height
│  [Files]  [Download]          /home/user/Music/  [Browse…] │
│  Search ___________________________                         │
│─────────────────────────────────────────────────────────────│
│  [art]  Filename        Format  Artist    Album    Dur  Size│
│  …all audio files in selected directory…                    │
│  Clicking a file loads it into the metadata editor above    │
└─────────────────────────────────────────────────────────────┘
```

The vertical split between the two sections is a draggable `ResizeHandle` (same component used by the sidebar and right panel).

---

## Metadata fields

Fields shown adapt to the detected format. All fields below are supported by `lofty 0.22` through its unified `Tag` API.

| Field | ID3v2 | Vorbis | iTunes M4A |
|---|---|---|---|
| Title | TIT2 | TITLE | ©nam |
| Artist | TPE1 | ARTIST | ©ART |
| Album | TALB | ALBUM | ©alb |
| Album Artist | TPE2 | ALBUMARTIST | aART |
| Year | TDRC | DATE | ©day |
| Track # / Total | TRCK | TRACKNUMBER | trkn |
| Disc # / Total | TPOS | DISCNUMBER | disk |
| Genre | TCON | GENRE | ©gen |
| Composer | TCOM | COMPOSER | ©wrt |
| Comment | COMM | COMMENT | ©cmt |
| BPM | TBPM | BPM | tmpo |
| Copyright | TCOP | COPYRIGHT | cprt |
| Lyrics | USLT | LYRICS | ©lyr |
| Artwork | APIC | METADATA_BLOCK_PICTURE | covr |

Artwork editing (drag-and-drop or file picker) is a follow-up — the backend API is in place via `lofty`'s picture API but not yet wired to the UI.

---

## Backend — Rust

### Storage crate (`melomaniac-storage`)

**`crates/storage/src/editor.rs`**

| Symbol | Description |
|---|---|
| `AudioMetadata` | Serialisable struct covering all editable fields + read-only `duration_ms`, `format`, `file_size` |
| `FileEntry` | Lightweight scan result — path, filename, format, size, basic tags, duration |
| `read_metadata(path)` | Read all tags from any audio file via lofty; runs in `spawn_blocking` |
| `write_metadata_to_file(path, metadata)` | Write tags to a non-CAS file on disk |
| `scan_directory(path)` | List all audio files in a directory with basic metadata; non-recursive |
| `edit_cas_track(old_hash, metadata, cas, db)` | Full CAS edit flow — see below |

**`edit_cas_track` flow:**
1. Look up `TrackRecord` to get `mime_type` (needed for temp-file extension)
2. Read original blob from CAS
3. Write bytes to a unique temp file (`/tmp/melomaniac_edit_{uuid}.{ext}`)
4. Apply new tags via lofty in `spawn_blocking`, save in-place
5. Read modified bytes back, delete temp file
6. BLAKE3 hash new bytes → `new_hash`
7. If `new_hash == old_hash` (no byte change), return early
8. Write new blob to CAS
9. `UPDATE tracks SET hash=new_hash, title=…` in DB
10. `patch_trees_parallel` — see below
11. Return `new_hash`

**`patch_trees_parallel` — multithreaded tree rewriting:**

```
db.get_all_branches_with_heads()
  │
  ├─ tokio::spawn ── branch A: read tree → patch hash → write new blob → insert commit ─┐
  ├─ tokio::spawn ── branch B: read tree → patch hash → write new blob → insert commit ─┤
  └─ tokio::spawn ── branch N: (skipped if track not in tree)                           ┘
                                                                                         │
                                                    join_all → batch_update_branch_heads()
                                                               (single DB transaction)
```

CAS reads, tree rewrites, new blob writes, and `insert_commit` all run concurrently across branches. Only the final HEAD advancement is serialized in one transaction. Branches that don't contain the edited track are skipped at no cost.

**New `Database` methods (`db.rs`):**

| Method | Description |
|---|---|
| `update_track_hash_and_metadata(old, new, title, artist, album)` | Atomic hash swap + metadata update |
| `get_all_branches_with_heads()` | Returns `Vec<(branch_id, head_commit_hash)>` for all non-null HEADs |
| `batch_update_branch_heads(updates)` | Advances multiple branch HEADs in a single transaction |

### Tauri commands (`src-tauri/src/editor.rs`)

| Command | Args | Returns |
|---|---|---|
| `file_read_metadata` | `path: String` | `Result<AudioMetadata, String>` |
| `file_write_metadata` | `path: String, metadata: AudioMetadata` | `Result<(), String>` |
| `file_scan_directory` | `path: String` | `Result<Vec<FileEntry>, String>` |
| `library_edit_track` | `hash: String, metadata: AudioMetadata` | `Result<String, String>` — new hash |

---

## Downloader (desktop only)

Implemented as a second tab in the bottom file-browser section.

**UI:**
- URL paste field with auto-detected source badge (YouTube · SoundCloud · Bandcamp · etc.)
- Format selector: FLAC / MP3 320k / OGG Vorbis
- Download button → in-progress list with per-item progress
- On completion: auto-ingests into CAS + SQLite library via `ingest_file`

**Backend (not yet implemented — see PLAN.md P0 yt-dlp section):**
- `ytdlp_download(url, format, output_dir)` Tauri command
- `std::process::Command` wrapper around the `yt-dlp` binary
- Progress streamed back to frontend via `AppHandle::emit("ytdlp://progress", …)`
- On completion: calls `ingest_file` then emits a library-refresh event

**Spotify:** blocked on librespot integration (P2). The downloader tab shows a "Spotify requires the librespot bridge — coming in P2" notice for Spotify URLs.

---

*Last updated: 2026-05-04. Backend (`lofty` read/write, `edit_cas_track`, parallel tree patch) complete and compiling. Frontend UI not yet built.*
