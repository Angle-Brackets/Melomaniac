# Melomaniac — Tracks, Playback & Playlist-as-Git Design

> Consolidated reference covering: filesystem storage, the ingest pipeline,
> Tauri playback commands, frontend data flow, and how every playlist is a
> content-addressable git-style repository with full version history.

---

## Part 1 — Storage & Playback

### 1. Storage layout on disk

All persistent data lives under Tauri's `app_data_dir`:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/com.melomaniac.app/` |
| Linux | `~/.local/share/com.melomaniac.app/` |
| Windows | `%APPDATA%\com.melomaniac.app\` |

```
com.melomaniac.app/
├── db.sqlite              ← SQLite metadata + playlist/commit history
└── objects/
    ├── 4f/
    │   └── a9b0c2…        ← audio blob (BLAKE3 hash, no extension)
    ├── 7e/
    │   └── 3c18d4…        ← artwork blob (raw image bytes)
    └── …
```

**Why CAS for audio files?** Free deduplication — importing the same track
twice is a no-op. The path is always computable from the hash:
`objects/<hash[..2]>/<hash[2..]>`. No file extensions; `mime_type` in SQLite
carries the format hint iOS/Android need.

**Why not reference the original path?** Moving or deleting the source file
would silently break playback. A future "link mode" opt-in can be added for
users with well-organised external drives.

---

### 2. Ingest pipeline

#### 2a. Local file import (implemented)

```
track_ingest_files(paths: Vec<String>)
  │
  ├── tokio::fs::read(path) → bytes
  ├── cas.write_blob(bytes) → hash           (idempotent)
  ├── detect_mime(bytes)    → "audio/mpeg" etc.
  ├── id3::Tag::read_from2(Cursor::new(bytes))
  │     title, artist, album, duration_ms (TLEN), artwork APIC frame
  ├── cas.write_blob(art_bytes) → artwork_hash   (if present)
  └── db.insert_track(TrackRecord)          (OR IGNORE — idempotent)
  │
  └── Returns Vec<TrackRecord>
```

Tag fallback: filename stem → "Unknown Artist" → 0 ms duration.
MIME detection uses magic bytes, not file extension — works on CAS paths.
Currently supports: MP3 (ID3v2.2/2.3/2.4). FLAC/OGG planned.

#### 2b. yt-dlp URL download (P1)

```
track_ingest_url(url: String)
  │
  ├── spawn yt-dlp --extract-audio --audio-format best -o - <url>
  ├── pipe stdout → bytes in memory
  ├── parse last-line JSON → metadata
  └── → same CAS + DB path as 2a
  │
  └── emits IngestProgress { url, pct: f32 } events during download
```

---

### 3. Tauri commands

| Command | Args | Returns | Notes |
|---|---|---|---|
| `track_ingest_files` | `paths: Vec<String>` | `Vec<TrackRecord>` | Batch local import; idempotent |
| `track_play` | `hash: String` | `()` | Resolve CAS path → load → play in one call |
| `track_get_artwork` | `hash: String` | `Vec<u8>` | Raw JPEG/PNG bytes; frontend converts to Blob URL |
| `track_ingest_url` | `url: String` | `TrackRecord` | yt-dlp wrapper (P1) |
| `audio_pause` | — | `()` | Pause without unloading |
| `audio_play` | — | `()` | Resume paused track |
| `audio_seek` | `position_ms: u64` | `()` | Scrub to position |
| `audio_set_volume` | `volume: f32` | `()` | 0.0–1.0 |

`track_play` uses `spawn_blocking` because `bridge.load` is synchronous
(rodio is not async-safe on macOS).

---

### 4. Artwork serving

CAS blobs have no extension so `<img src="…/objects/4f/a9b0…">` won't work.

**Current — raw bytes via invoke:**
```typescript
const bytes = await invoke<number[]>('track_get_artwork', { hash });
const url   = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
// Pass as artworkUrl to AlbumArt — revoke on track change
```

**Future — custom `melo://` asset protocol:** register a Tauri asset protocol
serving CAS blobs directly (`melo://objects/<hash>`). Zero IPC overhead;
implement when artwork size or frequency makes the current approach a bottleneck.

---

### 5. Frontend data flow

#### On startup
```
App mounts
  ├── invoke('library_get_all') → TrackRecord[]
  │     mapped via trackRecordToTrack() → Track[]
  │     replaces TRACKS mock if records.length > 0
  └── (future) invoke('playlist_get_all') → replace PLAYLISTS mock
```

#### Track selection and playback
```
Click row → handleSelectTrack(id)     ← selects / highlights only
Press ▶   → handlePlayPause()
  ├── if track.hash === loadedHash && playing  → audio_pause()
  ├── if track.hash === loadedHash && paused   → audio_play()
  └── if different track                       → track_play(hash)
                                                 setLoadedHash / setDurationMs
```

#### Position updates (PositionChanged events ~4 Hz)
```typescript
listen<AudioPayload>('audio://event', ({ payload }) => {
  if ('PositionChanged' in payload) setPositionMs(payload.PositionChanged);
  if (payload === 'TrackEnded')      setIsPlaying(false);
});
```
`seekPct` is derived: `positionMs / durationMs`. No rAF needed at 4 Hz.

#### Scrubbing
```typescript
onSeek(pct) {
  const ms = Math.floor(pct * durationMs);
  setPositionMs(ms);
  invoke('audio_seek', { positionMs: ms });
}
```

#### Artwork fetch (on active track change)
```typescript
if (track.artwork_hash && !artworkUrls[track.hash]) {
  const bytes = await invoke('track_get_artwork', { hash: track.hash });
  const url   = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  setArtworkUrls(prev => ({ ...prev, [track.hash]: url }));
}
// artworkUrl injected into carouselAlbums → AlbumArt background-image
```

---

### 6. Known limitations / open questions

- **Duration accuracy**: TLEN ID3 frame is absent from many files; shows `—`
  when unknown. Fix: run `symphonia` stream decoder for accurate duration on
  ingest (adds ~50 ms per file; worthwhile).
- **Format support**: MP3 only. FLAC needs `metaflac`, OGG needs `lewton`.
- **Large artwork**: >3 MB artwork should use the `melo://` protocol instead
  of IPC serialisation.
- **Volume persistence**: not saved across sessions; add `volume: f32` to a
  `settings` table.
- **Link mode**: copy-to-CAS doubles disk for users with large organised
  libraries. Opt-in `source_path` column + fallback resolution is the fix.

---

## Part 2 — Playlist as Git Repository

### 7. The object model

Everything persistable is a CAS blob identified by its BLAKE3 hash.
Three blob types mirror git exactly:

```
git concept     Melomaniac equivalent         Stored as
──────────────  ────────────────────────────  ──────────────────────────────
blob            audio file bytes              CAS object (binary)
tree            ordered track list + AB pts   CAS object (JSON, see §8)
commit          snapshot pointer + metadata   CAS object (JSON, see §9)
branch ref      head_commit in branches table SQLite (fast pointer lookup)
```

The `tracks` SQLite table is **not** part of the version history — it is a
mutable acceleration index (like git's pack index). The tree blob is the
source of truth for playlist order.

---

### 8. Tree blob format

```json
{
  "tracks": [
    { "hash": "4fa9b0c2…", "ab_start_ms": null,  "ab_end_ms": null  },
    { "hash": "7e3c18d4…", "ab_start_ms": 12000, "ab_end_ms": 95000 },
    { "hash": "a1b2c3d4…", "ab_start_ms": null,  "ab_end_ms": null  }
  ]
}
```

**Array order IS playlist order.** A reorder writes a new tree blob with the
same hashes in a different sequence — audio blobs are untouched (same as git
not copying file bytes on rename). Identical orderings produce the same hash,
deduplicating no-op commits.

---

### 9. Commit blob format

```json
{
  "tree_hash":  "9c2a31f0…",
  "parent":     "b7f19244…",
  "timestamp":  1746300000,
  "device_id":  "laptop-main",
  "message":    "Reorder: ambient tracks to top"
}
```

Root commits have `"parent": null`. Merge commits have two parents (stored in
`commit_parents` table, not this JSON, to keep the hash stable).

---

### 10. Reference graph

```
branches table
┌──────────────────────────────────────┐
│ playlist_id │ name  │ head_commit    │
│ uuid-1      │ main  │ 4fa9b0c2…      │  ← HEAD
│ uuid-1      │ dev   │ 7e3c18d4…      │
└──────────────────────────────────────┘
         │
         ▼ commit 4fa9b0c2
    ┌─────────────────────────────┐
    │ tree_hash:  9c2a31f0…       │
    │ parent:     b7f19244…       │
    └─────────────────────────────┘
         │ parent
         ▼ commit b7f19244
    ┌─────────────────────────────┐
    │ tree_hash:  3ed5b091…       │
    │ parent:     null            │  ← root commit
    └─────────────────────────────┘
```

Read path: `branches.head_commit → commits.tree_hash → CAS tree blob → [hashes] → db.get_track(hash) × n → Vec<TrackRecord> in order`

---

### 11. Working tree and dirty state

```
HEAD commit (committed)
    │
    │  user drags row → trackOrder state changes
    ▼
Working tree (dirty)    hasUncommitted = true

    user clicks "Commit reorder"
    ├── frontend sends ordered hashes to playlist_commit_tracks
    ├── backend: tree blob → commit blob → advance branch.head_commit
    └── hasUncommitted = false
```

No staging area — any reorder is implicitly staged and the full list is
committed at once (`git commit -a` model). This is correct for playlists:
you always commit the whole ordered snapshot, not per-track diffs.

---

### 12. Pending Tauri commands (not yet implemented)

| Command | Purpose |
|---|---|
| `playlist_get_head_tracks(playlist_id, branch)` | Read path: branch → HEAD → tree → TrackRecord[] |
| `playlist_commit_tracks(playlist_id, branch, entries, device_id, message)` | Write path: takes ordered hashes, builds tree + commit, advances HEAD |
| `playlist_checkout(playlist_id, commit_hash)` | Read tracks from any past commit (history browsing, read-only) |
| `playlist_diff(commit_a, commit_b)` | Added / removed / reordered between two commits |
| `playlist_log(playlist_id, branch, limit)` | Commit history with per-commit diff summaries |

`playlist_commit_tracks` replaces the current `branch_commit` as the
frontend-facing API. `branch_commit` stays as an internal helper.

---

### 13. Branching and merging

```
main:   A──B──C──────────────F (merge)
                  \          /
dev:               D──E────/
```

**No-conflict merge**: branches added different tracks → auto-union.
**Reorder conflict**: same track at different positions in both branches.
- Initial implementation: Ours/Theirs picker in UI.
- P2: Logoot/YATA CRDT for positional ops that converge deterministically.

---

### 14. Invariants

- **No empty commits**: if `tree_hash == parent.tree_hash`, return the
  existing commit hash rather than writing a duplicate.
- **Blobs must exist before commit**: `playlist_commit_tracks` verifies each
  hash is in CAS and `tracks` table.
- **History is append-only**: reverting creates a new commit whose tree equals
  an old one (`git revert` model), never moves the branch pointer backwards.

---

*Last updated: 2026-05-03. Parts 1 and 2 consolidated from DESIGN-playback.md and DESIGN-playlist-git.md.*
