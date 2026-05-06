# Melomaniac — Editor & Downloader

The Editor page covers three concerns unified under one view:
1. **Metadata editor** — read and rewrite tags on any audio file (CAS library or raw filesystem)
2. **Artwork editor** — set per-track artwork with canvas crop; pull from a shared artwork library
3. **Downloader** — pull audio from external sources (yt-dlp for YouTube / SoundCloud / Bandcamp; Spotify deferred to P2 via librespot)

---

## Platform behaviour

| Feature | Desktop | iOS / Mobile |
|---|---|---|
| Metadata editor (library tracks) | ✅ | ✅ |
| Metadata editor (filesystem files) | ✅ | ✗ — no accessible FS |
| Artwork editor | ✅ | ✅ — library tracks only |
| Filesystem browser | ✅ | ✗ |
| Downloader tab | ✅ | ✗ — `std::process::Command` forbidden in App Store sandbox |
| "Get more tracks" prompt | ✗ | ✅ — directs user to sync from desktop via LAN/Axum |

On mobile the page renders only the metadata editor and artwork editor for library tracks.

---

## Page layout (desktop)

```
┌─────────────────────────────────────────────────────────────────┐  ← top pane (~40%)
│  [Artwork 96×96 ✎hover]  filename.mp3  [MPEG]  [LIBRARY]  3:22  │
│                          [Save ●]  [Revert]  [Ingest to Library] │
│─────────────────────────────────────────────────────────────────│
│  ┌── Identity ──────────────────────────────────────────────┐   │
│  │  Title _________________   Artist ____________________   │   │
│  │  Album _________________   Album Artist ______________   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌── Numbering ─────────────────────────────────────────────┐   │
│  │  Year ___   Track __ / __   Disc __ / __                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌── Detail ─────────────────────────────────────────────────┐  │
│  │  Genre ___________   BPM ____   Composer _____________   │   │
│  │  Comment _________________________________________________│   │
│  │  Lyrics (textarea) _______________________________________│   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
════════════════ ResizeHandle (draggable) ════════════════════════
┌─────────────────────────────────────────────────────────────────┐  ← bottom pane (~60%)
│  [Library]  [Filesystem]  [Download]      ~/Music/  [Browse…]  │
│  Search ___________________________                              │
│─────────────────────────────────────────────────────────────────│
│  [art]  Title / Filename    Format  Artist    Album    Dur  Size │
│  …rows…  clicking loads into the metadata editor above          │
└─────────────────────────────────────────────────────────────────┘
```

The artwork thumbnail gains a pencil overlay on hover; clicking opens the **Artwork Modal** (see below).
The `●` on Save indicates unsaved changes (dot hidden when clean).

---

## Bottom pane — three tabs

### Library tab (default)
Shows **all CAS-ingested tracks** regardless of which playlist (if any) they belong to. This is the "Local Files" concept — every track Melomaniac manages lives here. Source: `library_get_all` (already in memory on the parent, passed as a prop). No disk scan needed.

Columns: thumbnail · title · format badge · artist · album · duration · size

### Filesystem tab
Path-based directory browser, non-recursive. Default path: `~/Music` if it exists, else the user's home directory. Path input + Browse button trigger `file_scan_directory`. Tracks shown here that are already in the CAS get a faint "In Library" indicator.

Columns: filename · format badge · artist · album · duration · size

### Download tab
URL paste + source badge detection + format selector (FLAC / MP3 320k / OGG Vorbis) + Download button (disabled until yt-dlp backend is wired in P1). Spotify URLs show a notice that librespot is required (P2).

---

## Artwork editor

### Trigger
The 96×96 artwork thumbnail in the header shows a semi-transparent dark overlay with a centered `✎` icon on hover. Clicking opens `ArtworkModal`.

### ArtworkModal layout
```
┌──────────────────────────────────────────────┐
│  Edit Artwork                            [×]  │
├──────────────────────────────────────────────┤
│  ┌──────────────────────┐                    │
│  │   500×500 canvas     │  Drop an image     │
│  │   [crop overlay]     │  here, or          │
│  │   drag to reframe    │  [Browse…]         │
│  └──────────────────────┘                    │
│  Hint: 500×500 px min · square · JPEG / PNG  │
├──────────────────────────────────────────────┤
│  ── From your artwork library ─────────────  │
│  [thumb] Album A   [thumb] Album B   …       │
│  (shows distinct artworks across all tracks) │
├──────────────────────────────────────────────┤
│  [Cancel]                   [Save Artwork]   │
└──────────────────────────────────────────────┘
```

### Canvas crop mechanic
- Dropped / picked image is drawn onto a `<canvas>` at its natural size.
- A fixed square viewport overlay (CSS absolutely positioned) tracks a `cropOrigin {x, y}` and `cropSize` in state.
- `mousedown` on the canvas begins a drag; `mousemove` updates `cropOrigin`; scroll wheel adjusts `cropSize`.
- On **Save Artwork**: `ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, 500, 500)` → `canvas.toBlob('image/jpeg', 0.92)` → `Array.from(new Uint8Array(buf))` → invoke backend command.

### Artwork library (reuse across tracks)
The DB already stores `artwork_hash` per track. A new query `get_artwork_library()` returns distinct `(artwork_hash, album, artist, track_count)` rows so the modal can display a thumbnail grid of every unique artwork in the library. Clicking a thumbnail skips the crop step and applies that CAS blob directly.

**Backend query (`db.rs`):**
```sql
SELECT artwork_hash, album, artist, COUNT(*) as track_count
FROM tracks
WHERE artwork_hash IS NOT NULL
GROUP BY artwork_hash
ORDER BY album
```

This lets you set the same art across an entire album in one click without touching the filesystem.

---

## Implementation phases

### Phase 1 — Visual refresh + file browser redesign (frontend only)
- Improve label readability: 11px Outfit, `--text-2`, normal letter-spacing
- Input backgrounds: `--bg-1` (one step lighter than page) with solid `--border-1` ring; `--accent` focus ring
- Group fields into labelled card sections: Identity · Numbering · Detail
- Rename bottom "Files" tab → "Filesystem", add "Library" tab as default
- Fix default filesystem scan path (`~/Music` → fallback to `$HOME`)
- Pass `tracks` prop into `EditorView` to power the Library tab (avoids a re-invoke)

### Phase 2 — Artwork editor + artwork library (frontend + Rust)
- Artwork hover overlay on the 96×96 thumbnail
- `ArtworkModal` component: canvas crop + drag-to-reframe + scroll-to-zoom + artwork library grid
- New `Database` method: `get_artwork_library() → Vec<ArtworkLibraryEntry>`
- New storage functions: `set_cas_artwork(hash, image_bytes, cas, db)` and `file_set_artwork(path, image_bytes)`
- Two new Tauri commands: `library_set_artwork(hash, imageBytes)` → new `artwork_hash`; `file_set_artwork(path, imageBytes)` → `()`
- Wire return value back to `artworkUrls` in `DesktopApp` so carousel updates immediately

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

---

## Backend — Rust

### Storage crate (`melomaniac-storage`)

**`crates/storage/src/editor.rs`** — complete and compiling

| Symbol | Description |
|---|---|
| `AudioMetadata` | Serialisable struct covering all editable fields + read-only `duration_ms`, `format`, `file_size` |
| `FileEntry` | Lightweight scan result — path, filename, format, size, basic tags, duration |
| `read_metadata(path)` | Read all tags from any audio file via lofty; runs in `spawn_blocking` |
| `read_cas_metadata(hash, cas, db)` | Read metadata from a CAS blob (temp-file approach for extension-less blobs) |
| `write_metadata_to_file(path, metadata)` | Write tags to a non-CAS file on disk |
| `scan_directory(path)` | List all audio files in a directory with basic metadata; non-recursive |
| `edit_cas_track(old_hash, metadata, cas, db)` | Full CAS edit flow — rewrites blob, new hash, DB update, parallel tree patch |
| `set_cas_artwork(hash, image_bytes, cas, db)` | *(Phase 2)* Write image as CAS blob, update `artwork_hash` in DB |
| `file_set_artwork(path, image_bytes)` | *(Phase 2)* Embed artwork into a filesystem audio file via lofty `Picture` API |

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
10. `patch_trees_parallel` — concurrent branch tree rewrites, single-transaction HEAD batch update
11. Return `new_hash`

**`set_cas_artwork` flow (Phase 2):**
1. BLAKE3 hash `image_bytes` → `artwork_hash`
2. Write image blob to CAS
3. `UPDATE tracks SET artwork_hash = ? WHERE hash = ?`
4. Return `artwork_hash`

Note: artwork is stored as a standalone CAS blob. It is NOT re-embedded into the audio blob (that would change the audio hash and trigger a full tree patch for a cosmetic change). The `artwork_hash` column is the source of truth for display; embedded tags in the audio file are a best-effort export for portability.

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

**`Database` methods (`db.rs`):**

| Method | Description | Status |
|---|---|---|
| `update_track_hash_and_metadata(old, new, title, artist, album)` | Atomic hash swap + metadata update | ✅ |
| `get_all_branches_with_heads()` | Returns `Vec<(branch_id, head_commit_hash)>` | ✅ |
| `batch_update_branch_heads(updates)` | Advances multiple HEADs in one transaction | ✅ |
| `get_artwork_library()` | Returns distinct `(artwork_hash, album, artist, count)` | Phase 2 |

### Tauri commands (`src-tauri/src/editor.rs`)

| Command | Args | Returns | Status |
|---|---|---|---|
| `file_read_metadata` | `path: String` | `Result<AudioMetadata, String>` | ✅ |
| `file_write_metadata` | `path: String, metadata: AudioMetadata` | `Result<(), String>` | ✅ |
| `file_scan_directory` | `path: String` | `Result<Vec<FileEntry>, String>` | ✅ |
| `library_read_metadata` | `hash: String` | `Result<AudioMetadata, String>` | ✅ |
| `library_edit_track` | `hash: String, metadata: AudioMetadata` | `Result<String, String>` — new hash | ✅ |
| `library_set_artwork` | `hash: String, imageBytes: Vec<u8>` | `Result<String, String>` — new artwork_hash | Phase 2 |
| `file_set_artwork` | `path: String, imageBytes: Vec<u8>` | `Result<(), String>` | Phase 2 |

---

## Downloader (desktop only)

Implemented as the third tab in the bottom section.

**UI:**
- URL paste field with auto-detected source badge (YouTube · SoundCloud · Bandcamp · etc.)
- Format selector: FLAC / MP3 320k / OGG Vorbis
- Download button → in-progress list with per-item progress
- On completion: auto-ingests into CAS + SQLite library via `ingest_file`

**Backend (not yet implemented — P1):**
- `ytdlp_download(url, format, output_dir)` Tauri command
- `std::process::Command` wrapper around the `yt-dlp` binary
- Progress streamed back to frontend via `AppHandle::emit("ytdlp://progress", …)`
- On completion: calls `ingest_file` then emits a library-refresh event

**Spotify:** blocked on librespot integration (P2). The downloader tab shows a notice for Spotify URLs.

---

*Last updated: 2026-05-05. Phase 1 (visual refresh + file browser redesign) and Phase 2 (artwork editor + artwork library) planned. All backend commands up to `library_edit_track` complete and compiling. Frontend UI built and wired.*
