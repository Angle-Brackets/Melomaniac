# Downloads Feature Spec

## Overview

The download system lets users paste a URL (YouTube, SoundCloud, Bandcamp) and
receive a fully ingested, tagged track in their library. Downloads run in
parallel, emit live progress events to the frontend, and auto-ingest on
completion. The UI lives in the existing Download tab inside EditorView.

---

## Database changes

Two new columns on `tracks`, added as a migration:

```sql
-- migration 0006_add_track_provenance.sql
ALTER TABLE tracks ADD COLUMN ingested_at  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN source_url   TEXT;
```

- `ingested_at` — Unix seconds timestamp set at ingest time. Drives the `[NEW]`
  badge (shown for 7 days after ingestion).
- `source_url` — the original URL that was downloaded, or NULL for locally
  imported files. Drives the `[UNPLAYLISTED]` logic and is shown in the editor
  info panel.

No existing rows are broken: `DEFAULT 0` for `ingested_at` means old tracks are
treated as "already seen"; `source_url` is nullable so local imports are fine.

---

## Track status tags

Two new badges appear in the library track list (EditorView bottom pane and
TrackList) on a per-row basis:

### `[NEW]`
- **Condition:** `ingested_at > 0` and `(now - ingested_at) < 7 days`
- **Style:** Accent-coloured pill, same family as the existing `LIBRARY` badge
- **Behaviour:** Purely cosmetic. Disappears after 7 days without any DB write.
- **Placement:** Directly after the track title in both the editor library tab
  and the full TrackList columns.

### `[UNPLAYLISTED]` → call it `LOOSE`
- **Condition:** Track exists in `tracks` table but does not appear in any
  branch tree across all playlists. Determined client-side by comparing
  `trackOrder` (the active playlist's tracks) against the full library list, or
  ideally as a server-side query.
- **Label:** `LOOSE` — short, unambiguous, not derogatory.
  Alternative considered: `INBOX` (implies intent), `FREE` (ambiguous).
  Decision: **`LOOSE`** until a better name is agreed.
- **Style:** Muted/secondary pill, dimmer than `NEW` — indicates a state to
  resolve, not an error.
- **Placement:** Same row position as `NEW`; both can appear simultaneously on a
  freshly downloaded track that hasn't been added to any playlist.
- **Backend query:** `library_get_loose_tracks` — returns hashes of tracks
  that are not referenced by any committed branch tree.

---

## yt-dlp wrapper (Rust)

### Binary strategy
yt-dlp is **not bundled**. On first use, the app checks for `yt-dlp` on `PATH`
and shows an inline error with install instructions if missing. Future work: add
a sidecar bundle in `tauri.conf.json`.

### Rust implementation — `src-tauri/src/downloader.rs`

```
DownloadJob {
    id:         Uuid,
    url:        String,
    fmt:        DownloadFmt,   // Flac | Mp3 | Ogg
    status:     DownloadStatus,
    progress:   f32,           // 0.0 – 1.0
    error:      Option<String>,
}

DownloadStatus = Queued | Downloading | Transcoding | Ingesting | Done | Failed
```

The download manager holds a `tokio::sync::Semaphore` with **3 permits** —
maximum 3 concurrent yt-dlp processes. Each job:

1. Acquires a semaphore permit.
2. Spawns `yt-dlp` via `tokio::process::Command` with args:
   - `--format bestaudio` (for FLAC/OGG)  
   - `--format bestaudio[ext=m4a]/bestaudio` then ffmpeg transcode for MP3
   - `--output /tmp/melomaniac_<uuid>.%(ext)s`
   - `--newline` to get line-buffered progress output
3. Reads stdout line-by-line to parse `[download] X%` lines → emits
   `download://progress` events.
4. On exit code 0, reads the output file and calls `ingest_bytes()` with
   `source_url` set.
5. Emits `download://done` or `download://error`.
6. Releases the semaphore permit.

### Tauri events (backend → frontend)

```
download://progress  { id, url, pct: f32, status: string }
download://done      { id, url, track_hash: string }
download://error     { id, url, error: string }
```

### Tauri commands

| Command | Args | Returns |
|---|---|---|
| `download_enqueue` | `url: String, fmt: DownloadFmt` | `Result<Uuid, String>` |
| `download_cancel`  | `id: Uuid` | `Result<(), String>` |
| `download_queue`   | — | `Vec<DownloadJob>` |

---

## Parallel download model

```
download_enqueue("url-A", Mp3)   ─── permit 1 ──▶ yt-dlp process A
download_enqueue("url-B", Flac)  ─── permit 2 ──▶ yt-dlp process B
download_enqueue("url-C", Ogg)   ─── permit 3 ──▶ yt-dlp process C
download_enqueue("url-D", Mp3)   ─── waiting for permit... (queued in UI)
```

- Semaphore limit: **3** concurrent downloads. Chosen because yt-dlp itself is
  I/O-bound and most hosts throttle beyond 3 simultaneous connections anyway.
- Jobs that exceed the limit are held in a `VecDeque<DownloadJob>` and
  dispatched as permits are released — FIFO order.
- Each job runs on its own `tokio::task::spawn`; the semaphore is the only
  coordination primitive needed.
- Cancellation: sends `SIGKILL` to the yt-dlp child process and removes the
  partial output file.

---

## Frontend — Download tab (EditorView)

### Queue view
Replace the current single-URL-and-button layout with a two-section layout:

**Top — input area** (unchanged URL input + format selector + Add button)

**Bottom — queue list** (new; appears once at least one job exists)
Each row:
```
[thumbnail or spinner]  Title / URL (truncated)      [progress bar]  [cancel ×]
                        Artist · format               X% or DONE/ERR
```

- Progress bar uses the accent colour.
- `DONE` rows persist for 30 seconds then fade out.
- `ERROR` rows persist with a red tint and an expandable error message.
- Queue list is scrollable; max visible height ~240 px before scrolling.

### Auto-ingest feedback
When a `download://done` event arrives:
1. Call `library_get_all` to refresh `trackOrder` (or optimistically prepend
   the new `TrackRecord`).
2. Show `gitToast` — `"Downloaded: <title> · added to library"`.
3. Increment `commitRefreshKey` (since auto-ingest triggers a commit).

---

## Format mapping

| UI label | yt-dlp args | Expected output |
|---|---|---|
| FLAC | `--format bestaudio --audio-format flac -x` | `.flac` |
| MP3 320k | `--format bestaudio --audio-format mp3 --audio-quality 0 -x` | `.mp3` |
| OGG Vorbis | `--format bestaudio --audio-format vorbis -x` | `.ogg` |

Requires ffmpeg on PATH alongside yt-dlp for transcoding. Same install-check
approach as yt-dlp: error inline on first use.

---

## Open questions

- **`LOOSE` tag label** — `LOOSE` is the working name. Other candidates:
  `INBOX`, `STRAY`, `UNLINKED`. Decide before implementation.
- **7-day NEW window** — configurable in Settings later, hardcoded for now.
- **yt-dlp sidecar** — bundle strategy TBD. For now, require `PATH` install.
- **Playlist auto-add** — option to automatically add downloaded tracks to the
  active playlist. Not in scope for this phase; would require a new setting.
- **Metadata override** — yt-dlp extracts title/artist from the page; the user
  may want to edit before ingest. Deferred — use editor post-download for now.
