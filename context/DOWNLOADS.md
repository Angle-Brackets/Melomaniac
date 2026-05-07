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
  imported files. Shown in the editor info panel.

No existing rows are broken: `DEFAULT 0` for `ingested_at` means old tracks are
treated as "already seen"; `source_url` is nullable so local imports are fine.

---

## Track status tags

Two new badges appear in the library track list (EditorView bottom pane and
TrackList) on a per-row basis:

### `NEW`
- **Condition:** `ingested_at > 0` and `(now - ingested_at) < 7 days`
- **Style:** Accent-coloured pill, same family as the existing `LIBRARY` badge
- **Behaviour:** Purely cosmetic. Disappears after 7 days without any DB write.
- **Placement:** Directly after the track title in both the editor library tab
  and the full TrackList columns.

### `STRAY`
- **Condition:** Track exists in `tracks` table but does not appear in any
  branch tree across all playlists.
- **Style:** Muted/secondary pill, dimmer than `NEW` — indicates a state to
  resolve, not an error.
- **Placement:** Same row position as `NEW`; both can appear simultaneously on a
  freshly downloaded track that hasn't been added to any playlist.
- **Backend query:** `library_get_stray_tracks` — returns hashes of tracks
  that are not referenced by any committed branch tree.

---

## Downloader backend — binary strategy

**tl;dr: bundle yt-dlp as a Tauri sidecar.** The user never installs anything.

### Option comparison

| Approach | Sites | Bundleable | Transcoding | Maintenance |
|---|---|---|---|---|
| **yt-dlp sidecar** (recommended) | 1000+ | ✓ via Tauri sidecar | via bundled/system ffmpeg | Update binary with app releases |
| `rusty_ytdl` Rust crate | YouTube only | ✓ native library | need separate encoder | Crate is maintained but YouTube-only |
| Require PATH install | 1000+ | ✗ user must install | via system ffmpeg | Nothing to maintain, bad UX |

### Why not a pure-Rust crate?

`rusty_ytdl` is the most capable pure-Rust option. It works well for YouTube
but has two hard limits:

1. **YouTube-only.** SoundCloud and Bandcamp require separate scrapers with no
   maintained Rust equivalents. We'd need to maintain platform-specific code for
   each site, essentially re-building yt-dlp piecemeal.

2. **No transcoding.** It delivers the raw stream (m4a/opus/webm). Converting to
   FLAC/MP3/OGG requires either bundling ffmpeg anyway, or integrating separate
   pure-Rust encoder crates (`mp3lame-encoder`, `flac`, `lewton`) which adds
   significant complexity and licensing surface area.

### Why sidecar yt-dlp is actually fine

yt-dlp ships pre-compiled standalone binaries for macOS (arm64/x86_64), Linux,
and Windows — no Python runtime required. Tauri's `bundle.externalBin` config
bundles the correct binary for each platform target inside the app package.

```json
// tauri.conf.json
"bundle": {
  "externalBin": ["binaries/yt-dlp"]
}
```

The binary is named `yt-dlp-<target-triple>` and Tauri resolves the right one
at runtime via `tauri::api::process::current_binary()`. The user sees nothing —
it's fully transparent, same as Electron apps bundling Node.

**Update strategy:** yt-dlp is pinned to a specific release. App updates ship
a new binary. For sites that break between releases (YouTube changes APIs
frequently), users can override with a newer system yt-dlp on PATH — the
downloader checks PATH first, falls back to the bundled binary.

### ffmpeg

yt-dlp requires ffmpeg for transcoding to FLAC/MP3/OGG. Options in order of
preference:

1. **Bundle ffmpeg sidecar too** (increases app size ~70 MB). Clean UX.
2. **Require system ffmpeg** — show a one-time inline error if missing.
3. **Skip transcoding, ingest native format** — deliver m4a/opus directly.
   Symphonia (already in the project) can decode these. Format selector would
   be hidden or show "native quality" only. Simplest short-term path.

**Decision for Phase 1:** option 3 — ingest the native stream format, skip the
format selector for downloaded tracks. Transcoding support added later.
This means no ffmpeg dependency at all in Phase 1.

---

## Rust implementation — `src-tauri/src/downloader.rs`

```
DownloadJob {
    id:         Uuid,
    url:        String,
    fmt:        DownloadFmt,   // Native | Flac | Mp3 | Ogg  (Native = Phase 1 only)
    status:     DownloadStatus,
    progress:   f32,           // 0.0 – 1.0
    title:      Option<String>,
    error:      Option<String>,
}

DownloadStatus = Queued | Downloading | Ingesting | Done | Failed
```

The download manager holds a `tokio::sync::Semaphore` with **3 permits**.
Each job:

1. Acquires a semaphore permit.
2. Resolves yt-dlp binary path (PATH → bundled sidecar).
3. Spawns yt-dlp via `tokio::process::Command`:
   - `--format bestaudio`
   - `--output /tmp/melomaniac_<uuid>.%(ext)s`
   - `--newline --progress` for line-buffered progress
   - `--print after_move:filepath` to get the final output path
4. Reads stdout line-by-line; parses `[download] X%` → emits progress events.
5. On exit 0, reads the output file bytes → calls `ingest_bytes()` with
   `source_url` and `ingested_at` set.
6. Emits `download://done` or `download://error`. Releases permit.

### Tauri events (backend → frontend)

```
download://progress  { id, pct: f32, status: string }
download://done      { id, track_hash: string, title: string }
download://error     { id, error: string }
```

### Tauri commands

| Command | Args | Returns |
|---|---|---|
| `download_enqueue` | `url: String` | `Result<String, String>` (job UUID) |
| `download_cancel`  | `id: String` | `Result<(), String>` |
| `download_queue`   | — | `Vec<DownloadJob>` |

---

## Parallel download model

```
download_enqueue("url-A")   ─── permit 1 ──▶ yt-dlp process A
download_enqueue("url-B")   ─── permit 2 ──▶ yt-dlp process B
download_enqueue("url-C")   ─── permit 3 ──▶ yt-dlp process C
download_enqueue("url-D")   ─── waiting for permit... (queued in UI as QUEUED)
```

- Semaphore limit: **3** concurrent downloads.
- Jobs beyond the limit sit in a `VecDeque<DownloadJob>` with `Queued` status
  and are dispatched FIFO as permits are released.
- Each job is a `tokio::spawn` task; the semaphore is the only coordination
  primitive needed.
- Cancellation: `SIGKILL` to the child process + temp file cleanup.

---

## Frontend — Download tab (EditorView)

### Queue view
Replace the current single-URL-and-button layout:

**Top — input area** (URL input + Add button; format selector hidden in Phase 1)

**Bottom — queue list** (appears once at least one job exists)
```
[spinner/art]  Title or truncated URL            ████████░░  72%   [×]
               youtube.com · downloading
```

- Accent-coloured progress bar.
- `DONE` rows show for 30 s then fade out.
- `ERROR` rows persist in red with an expandable error string.
- Max visible height ~240 px, scrollable.

### Auto-ingest feedback
When `download://done` arrives:
1. Refresh `trackOrder` via `library_get_all`.
2. Show `gitToast` — `"Downloaded: <title> · added to library"`.
3. Increment `commitRefreshKey`.

---

## Open questions

- **ffmpeg bundling** — Phase 1 skips transcoding entirely (native format).
  Phase 2 decision: bundle ffmpeg sidecar or require system install.
- **7-day NEW window** — hardcoded for now, Settings knob later.
- **yt-dlp update cadence** — pin to a release tag in CI, bump with each app
  release. Consider an in-app "check for yt-dlp update" button in Settings.
- **Playlist auto-add** — option to add downloaded tracks to the active
  playlist on completion. Deferred to a later phase.
- **Metadata pre-ingest edit** — let user review yt-dlp-extracted tags before
  committing to library. Deferred — use editor post-download for now.
