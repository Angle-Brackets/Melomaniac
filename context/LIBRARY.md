# Melomaniac — Library View

The Library view is a full-width, standalone panel accessible from the `Library` rail icon (music note). It shows every track the app is aware of — downloaded, locally imported, or ingested from the filesystem — regardless of playlist membership.

It is distinct from the Editor's bottom pane "Library" tab, which is a compact list scoped to the Editor workflow. The Library view is the primary place to:

- See the full local catalog at a glance
- Import local files and folders
- Bulk-edit shared metadata across many tracks
- Manage status (delete, add to playlist)

---

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Library                  [Import Files]  [Import Folder]        │
│  ──────────────────────────────────────────────────────────────  │
│  Search ___________   [All ▾]  [NEW]  [STRAY]  [Local]  [DL]    │
│  ──────────────────────────────────────────────────────────────  │
│  □  art  Title          Artist        Album       Dur   Source  S│
│  □  ▪▪▪  Track name     Anna Bair     Coffee …   3:22   Local    │
│  □  ▪▪▪  Another one    Lorun         —          5:11   yt ↗  NEW│
│  …                                                               │
│  ──────────────────────────────────────────────────────────────  │
│  [Bulk Edit Metadata]  [Add to Playlist]  [Delete]   3 selected  │
└─────────────────────────────────────────────────────────────────┘
```

- No carousel, no playlist context, no right panel — full center column width.
- Columns are sortable (click header). Default: artist → album → title.
- The bulk action bar appears at the bottom only when ≥1 row is selected.

---

## Columns

| Column | Width | Notes |
|---|---|---|
| Checkbox | 28px | Select row; header checkbox = select all visible |
| Thumbnail | 28px | 22×22 art |
| Title | 1fr | Track title + NEW / STRAY badges inline |
| Artist | 160px | |
| Album | 160px | |
| Duration | 52px | `M:SS` |
| Source | 90px | `Local` or domain of `source_url` (e.g. `youtube.com`) with external link icon |
| Status | 28px | Last column, reserved for future use |

---

## Filters

Chips in the toolbar, combinable:

- **All** — default, no filter
- **NEW** — `ingested_at > 0` and within 7 days (see DOWNLOADS.md)
- **STRAY** — not referenced by any branch tree (see DOWNLOADS.md)
- **Local** — `source_url IS NULL`
- **Downloaded** — `source_url IS NOT NULL`

---

## Local file import

The Library view is the primary import surface (the Editor filesystem tab remains for power users who want to browse before ingesting).

### Import buttons
- **Import Files** — opens a native file picker (`tauri-plugin-dialog`), multi-select, filtered to audio extensions (`mp3, flac, ogg, wav, m4a, aac, opus`). Calls existing `track_ingest_files` command.
- **Import Folder** — opens a native folder picker, recursively scans for audio files, ingests all found. Uses `file_scan_directory` + `track_ingest_files`.

### Drag and drop
- Drop audio files or a folder anywhere on the Library panel to import.
- Shows a drop overlay ("Drop to import") while dragging over the panel.
- Uses the same ingest pipeline; duplicate hashes are silently ignored (idempotent).

### Post-import
- Newly ingested tracks appear immediately in the list with the NEW badge.
- No separate "ingest" step — drop = done.

---

## Bulk selection

- **Click row** — select single track, deselect others (standard single-select).
- **Shift+click** — extend selection to range.
- **Ctrl/Cmd+click** — toggle individual rows without clearing selection.
- **Header checkbox** — select all filtered-visible rows; click again to deselect all.
- Selection is cleared when filters or search change.

---

## Bulk actions (bottom bar, visible when ≥1 selected)

| Action | Behaviour |
|---|---|
| **Bulk Edit Metadata** | Opens the Bulk Edit panel (see below) |
| **Add to Playlist** | Dropdown/modal to pick a playlist branch; appends tracks to the tree and commits |
| **Delete** | Two-click confirm; removes from DB (CAS blob retained) |

---

## Bulk Edit Metadata panel

Opens as a slide-up panel (or modal) over the Library view. Shows only the fields that are safe and meaningful to apply to a heterogeneous set of tracks.

### Editable in bulk

These fields are shared across an album/artist grouping and have the same value for all tracks in the set:

| Field | Why bulk-safe |
|---|---|
| Artist | Same across a release |
| Album | Same across a release |
| Album Artist | Same across a release |
| Year | Same across a release |
| Genre | Same across a release |
| Composer | Same across a release |
| Copyright | Same across a release |
| Artwork | Handled by existing ArtworkModal (already supports multi-track) |

### Not editable in bulk

These fields are per-track and should only be edited one-at-a-time in the single-track Editor:

| Field | Reason |
|---|---|
| Title | Unique per track |
| Track number / total | Unique per track |
| Disc number / total | Unique per track |
| Lyrics | Unique per track |
| Comment | Unique per track |
| BPM | Unique per track |

### Panel layout

```
┌── Bulk Edit — 4 tracks selected ──────────────────────────────┐
│  Artist        [________________]                              │
│  Album         [________________]                              │
│  Album Artist  [________________]                              │
│  Year          [______]                                        │
│  Genre         [________________]                              │
│  Composer      [________________]                              │
│  Copyright     [________________]                              │
│                                                                │
│  Artwork       [Current mix ▸]  [Change Artwork…]             │
│                                                                │
│  Empty fields = leave existing values untouched.              │
│  Filled fields overwrite all N selected tracks.               │
│                                                                │
│                        [Cancel]  [Apply to 4 tracks]          │
└────────────────────────────────────────────────────────────────┘
```

- **Empty field = no-op** for that field. Only filled fields are written.
- A field with a placeholder like `(3 values)` means the selected tracks have differing values — filling it will unify them.
- Apply calls `library_edit_track` per track (existing command) for each non-empty field, then creates changelog commits on affected branches exactly like single-track edits do.

### Editor refactor needed

The current `EditorView` is single-track focused. The Bulk Edit panel is a new surface, not a modification to the existing Editor. It can share:

- The same field input styles (reuse `INPUT_STYLE`, `LABEL_STYLE`)
- The `ArtworkModal` component (already supports multi-track via `scope = 'tracks'`)
- The `library_edit_track` Tauri command (call once per track per changed field)

No changes to the single-track Editor are needed for Phase 1 of bulk edit.

---

## Backend requirements (new or changed)

| Item | Status |
|---|---|
| `track_ingest_files` | ✅ exists |
| `file_scan_directory` | ✅ exists |
| `library_remove_track` | ✅ exists |
| `library_get_all` | ✅ exists |
| `library_get_stray_tracks` | ✅ exists |
| `library_edit_track` | ✅ exists (single-track) |
| `tauri-plugin-dialog` file/folder picker | ❌ needs adding |
| Bulk metadata apply (loop on frontend) | ❌ frontend only, no new command needed |

---

## Phasing

### Phase 1 — table + import
- Full sortable/filterable track table
- NEW / STRAY badges
- Import Files + Import Folder buttons
- Drag-and-drop import
- Single-track delete (already done in Editor library tab)
- Open selected track in Editor (single-click or context menu)

### Phase 2 — bulk actions
- Bulk selection (checkbox + shift-click + header checkbox)
- Bulk delete
- Add to Playlist
- Bulk Edit Metadata panel

### Phase 3 — polish
- Column resizing
- Persistent sort preference
- "Add to queue" from context menu
- Inline playback (click row to play without opening Editor)
