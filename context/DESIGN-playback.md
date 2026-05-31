# Melomaniac — Real Audio Playback Design

> Scope: ingesting audio files from the filesystem, storing them, and driving live
> playback from the UI. Covers storage layout, the ingest pipeline, new Tauri
> commands, and the frontend data flow. Does not cover P2P sync or streaming.

---

## 1. Storage layout on disk

All persistent data lives under Tauri's `app_data_dir`:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/com.melomaniac.app/` |
| Linux | `~/.local/share/com.melomaniac.app/` |
| Windows | `%APPDATA%\com.melomaniac.app\` |

Directory tree inside `app_data_dir`:

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

**Why CAS for audio files?**
The CAS already exists and gives free deduplication — importing the same track twice
is a no-op. The path is always computable from the hash: `objects/<hash[..2]>/<hash[2..]>`.
There are no file extensions; the `mime_type` column in `tracks` carries the format hint
that iOS/Android need.

**Why not reference the original path?**
Moving or deleting the source file would silently break playback. CAS gives permanent,
location-independent storage at the cost of doubling disk usage during import. A future
"link mode" (store path, not bytes) can be added as an opt-in setting.

---

## 2. Ingest pipeline

### 2a. Local file import

```
User picks files via dialog
        │
        ▼
[Tauri: track_ingest_files(paths)]
        │
        ├── read bytes from disk
        ├── cas.write_blob(bytes) → audio_hash
        ├── extract id3/vorbis tags (title, artist, album, duration_ms, mime_type)
        ├── extract embedded artwork → cas.write_blob(art_bytes) → artwork_hash
        └── db.insert_track(TrackRecord { audio_hash, … }) OR IGNORE (idempotent)
        │
        ▼
 Returns Vec<TrackRecord> (newly inserted or already-existing)
```

**Crate additions:**
- `id3` — read ID3v2 tags from MP3 (already planned in PLAN.md)
- `metaflac` — read Vorbis comments + PICTURE block from FLAC
- `infer` — MIME type sniffing from magic bytes (handles unlabelled files)

**Tag fallback strategy:**
1. Try `id3` (MP3) then `metaflac` (FLAC) on the raw bytes.
2. If no title tag: use the filename stem, stripped of extension.
3. If no artist tag: `"Unknown Artist"`.
4. If no duration: decode the first 8 KB of audio with `symphonia` to extract stream info.

### 2b. yt-dlp URL download (P1)

```
User pastes URL
        │
        ▼
[Tauri: track_ingest_url(url)]
        │
        ├── spawn yt-dlp --extract-audio --audio-format best
        │               --print-json -o - <url>
        ├── pipe stdout → accumulate bytes in memory
        ├── parse last-line JSON → title, artist (uploader), duration_ms, etc.
        ├── cas.write_blob(bytes) → hash
        └── db.insert_track(…)
        │
        ▼
 Returns TrackRecord + emits IngestProgress events during download
```

yt-dlp writes JSON metadata to stderr and audio bytes to stdout when `-o -` is used.
Progress events (`IngestProgress { url, pct: f32 }`) are emitted via `AppHandle::emit`
so the frontend can show a progress bar.

---

## 3. Tauri command changes

### 3a. Replace `audio_load(path)` with `track_play(hash)`

The current `audio_load` command takes a raw filesystem path. This leaks CAS internals
to the frontend and forces the frontend to construct a path it shouldn't know about.

**New command:**

```rust
#[tauri::command]
pub async fn track_play(
    hash: String,
    storage: State<'_, StorageState>,
    audio: State<'_, AudioState>,
) -> Result<(), String>
```

Internally:
1. `db.get_track(&hash)` → `TrackRecord` (title, artist, mime_type, …)
2. `cas.blob_path(&hash)` → `PathBuf`
3. Construct `TrackMetadata` from the record
4. `spawn_blocking` → `bridge.load(AudioSource::File(path), meta)` → `bridge.play()`

The existing `audio_load` stays as an internal detail used only by the debug command;
it is not exposed to the frontend in production.

**Updated frontend invocation:**

```typescript
// Before (never shipped to users):
await invoke('audio_load', { path: '/some/path', metadata: { … } });
await invoke('audio_play');

// After:
await invoke('track_play', { hash: track.hash });
```

### 3b. New commands summary

| Command | Args | Returns | Notes |
|---|---|---|---|
| `track_ingest_files` | `paths: Vec<String>` | `Vec<TrackRecord>` | Batch local import |
| `track_play` | `hash: String` | `()` | Resolve + load + play in one call |
| `track_get_artwork` | `hash: String` | `Vec<u8>` (PNG/JPEG bytes) | For small artworks; see §5 for large |
| `track_ingest_url` | `url: String` | `TrackRecord` | yt-dlp wrapper (P1) |

`track_ingest_files` and `track_ingest_url` are `async` commands; they run on the Tauri
async runtime and are safe to await from JS.

`track_play` must `spawn_blocking` for the synchronous `bridge.load` call (rodio is not
async-safe on macOS — same pattern as `debug_play_test_track`).

---

## 4. Artwork serving

CAS blobs have no extension, so `<img src="…/objects/4f/a9b0…">` will not work.
Two options:

**Option A — Raw bytes via invoke (chosen for now)**
`track_get_artwork(hash)` returns `Vec<u8>`, which the frontend converts to a `Blob` URL:

```typescript
const bytes = await invoke<number[]>('track_get_artwork', { hash });
const url   = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
// <img src={url} /> — revoke on unmount
```

Simple. Works. Slightly wasteful for large art (serialised through IPC).
Acceptable for album art (typically 300–500 KB).

**Option B — Custom `melo://` asset protocol (future)**
Register a Tauri asset protocol that serves CAS blobs directly, bypassing IPC:
`melo://objects/<hash>` → stream file. Zero-copy. Better for large embedded art or
if artwork is displayed in many places simultaneously. Implement when needed.

---

## 5. Frontend data flow

### On startup

```
App mounts
   │
   ├── invoke('library_get_all') → librarySlice.setTracks(TrackRecord[])
   └── invoke('playlist_get_all') → playlistSlice.setPlaylists(PlaylistWithBranches[])
```

`DesktopApp.tsx` currently uses `TRACKS` / `ALBUMS` / `PLAYLISTS` mock constants.
These get replaced by the Zustand store slices once the invoke calls are wired.

### Track selection → playback

```
User clicks row / carousel card
   │
   ▼
handleSelectTrack(hash)
   │
   ├── invoke('track_play', { hash })   ← single call does load + play
   └── setActiveTrackId(hash)           ← UI highlight
```

The `activeTrackId` currently uses the numeric mock `id` field. Once real data is used,
it becomes `hash: string`. The `TrackRecord` returned by `library_get_all` is the source
of truth; mock `id` fields are dropped.

### Seek bar / position updates

`AudioEvent::PositionChanged(u64)` is already emitted by the desktop backend ~4× per
second. The frontend listens via:

```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<AudioEvent>('audio://event', ({ payload }) => {
  if (payload.type === 'PositionChanged') {
    positionRef.current = payload.data;   // useRef — no re-render
    seekBarRef.current?.style.setProperty('--pct', `${payload.data / durationMs}`);
  }
  if (payload.type === 'TrackEnded') {
    advanceQueue();
  }
});
```

The position is stored in a `useRef`, not state. A `requestAnimationFrame` loop reads
it and updates the seek bar's CSS custom property directly — zero React re-renders for
the 4 Hz position tick.

---

## 6. SQLite changes

The existing `tracks` table already has all needed columns. No schema migration is
required for the initial ingest + playback feature. The `added_at` timestamp column
(planned but not in the current schema) should be added in a new migration for
"Added" column display in the track list.

Proposed migration `0005_track_added_at.sql`:

```sql
ALTER TABLE tracks ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0;
```

---

## 7. File picker (Tauri plugin)

The `tauri-plugin-dialog` crate needs to be added to `src-tauri/Cargo.toml` and
registered in `lib.rs`. The frontend calls `open({ multiple: true, filters: [{ name: 'Audio', extensions: ['mp3','flac','aac','ogg','wav'] }] })` from `@tauri-apps/plugin-dialog`, passes the returned paths to `track_ingest_files`.

The permission `dialog:allow-open` must be added to the app's capability JSON
(`src-tauri/capabilities/default.json` or a new `ingest.json`).

---

## 8. Implementation order

1. **`track_ingest_files`** — add `id3` + `infer` crates, implement the command, wire
   a file-picker button in the Sidebar's yt-dlp stub area. This gets real tracks into
   the library without touching playback.

2. **`track_play`** — one-command playback from hash. Wire `handleSelectTrack` to invoke
   it. At this point, clicking a row plays audio.

3. **Seek bar / position loop** — listen to `audio://event`, drive seek bar via `useRef`
   + CSS custom property. Wire the seek bar drag back to `audio_seek`.

4. **Artwork** — `track_get_artwork` + Blob URL in `AlbumArt` component.

5. **Library / playlist from real data** — replace mock constants with `library_get_all`
   / `playlist_get_all` invoke calls on mount.

6. **yt-dlp ingest** (P1) — `track_ingest_url` + progress events.

---

## 9. Open questions

- **Link mode** — should power users be able to keep files in-place (reference by path)
  rather than copying into CAS? Useful when the library is already well-organised on an
  external drive. Would need a `source_path` column and fallback resolution logic.

- **Format support** — rodio + symphonia-all covers MP3, FLAC, AAC, OGG, WAV, OPUS.
  Apple Lossless (ALAC) and DSD are not supported by symphonia. Worth documenting as
  a known limitation.

- **Large artwork** — the `melo://` asset protocol (§4 Option B) should be implemented
  before shipping if artworks are sourced from high-res scans (3–10 MB). The IPC
  serialisation overhead for 8 MB is noticeable.

- **Volume persistence** — `audio_set_volume` exists but volume is not persisted across
  sessions. Add `volume: f32` to a `settings` table or a small `settings.json` sidecar.

*Last updated: 2026-05-03.*
