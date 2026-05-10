# Melomaniac — Mobile UI Wiring

> Scope document for connecting the mobile React screens (`src/mobile/`) to the real Tauri backend and shared Zustand store. All Tauri commands already work on iOS (confirmed on device). The screens currently render mock data from `src/mobile/data.ts` — this document tracks what needs to change.

---

## Architecture notes

### Store sharing

The Zustand store (`src/store/`) is a module-level singleton. Both `DesktopApp` and `MobileApp` can call `useStore(...)` directly — no Provider needed. The four slices are:

| Slice | Key state |
|---|---|
| `librarySlice` | `tracks: TrackRecord[]`, `loadLibrary()`, `setFavorite()` |
| `playlistSlice` | `playlists: PlaylistWithBranches[]`, `loadPlaylists()` |
| `playbackSlice` | `loadedHash`, `isPlaying`, `durationMs`, `volume` |
| `queueSlice` | `queue`, `activeIndex`, manual queue ops |

`MobileApp` needs to call `loadLibrary()` and `loadPlaylists()` on mount (same as `DesktopApp`).

### Artwork pattern

All artwork comes back as `number[]` (raw bytes) from Tauri — same for tracks and playlists:

```ts
const bytes = await invoke<number[]>('track_get_artwork', { hash })
const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
```

A shared `useArtwork(hash, command)` hook (or a mobile-local equivalent) should cache blob URLs to avoid re-fetching on every render.

### Position tracking

Desktop uses a `requestAnimationFrame` loop writing directly to DOM refs (zero React re-renders). Mobile should do the same: keep `positionMsRef` in a ref, listen to `audio://event` → `PositionChanged(ms)` to update it, and drive the progress bar via a rAF loop writing to a DOM ref.

---

## Phase 1 — Read-only wiring (show real data)

### 1.1 Shared store mount

**File:** `src/mobile/MobileApp.tsx`

- Call `loadLibrary()` and `loadPlaylists()` in `useEffect` on mount
- Pass `isPlaying`, `loadedHash`, active track info down to `MiniPlayer` and `NowPlaying`

---

### 1.2 Library screen

**File:** `src/mobile/components/Library.tsx`

| What | How |
|---|---|
| Track list | `useStore(s => s.tracks)` — populated by `library_get_all` |
| Track artwork | `invoke<number[]>('track_get_artwork', { hash })` → blob URL → replace gradient MMArt with `<img>` overlay |
| Favorites filter | `useStore(s => s.tracks.filter(t => t.favorited))` |
| Track count / size | From `tracks.length`; size is not available yet (future: sum `duration_ms`) |
| Search | Filter `tracks` by `title`/`artist`/`album` — client-side, no invoke needed |
| MiniPlayer | Real state (see §1.5) |

**Mock data to retire:** Remove `TRACKS` import, replace with store-derived `TrackRecord[]`. The `TrackRow` component needs to accept `TrackRecord` instead of the local `Track` type and derive `albumRef` from `artwork_hash` (or just pass the blob URL directly).

---

### 1.3 Playlists screen

**File:** `src/mobile/components/Library.tsx` → `PlaylistsList`

| What | How |
|---|---|
| Playlist list | `useStore(s => s.playlists)` — `PlaylistWithBranches[]` |
| Playlist artwork | `invoke<number[]>('playlist_get_artwork', { playlistId })` → blob URL |
| Branch info | `playlist.branches` — eager-loaded; show `branches[0].name` as active branch, `branches.length` as branch count |
| HEAD commit hash | `branches[0].head_commit?.slice(0, 6)` |
| Uncommitted indicator | Requires comparing working tree to HEAD — skip for Phase 1; show static badge from commit history if needed |

---

### 1.4 Now Playing screen

**File:** `src/mobile/components/NowPlaying.tsx`

| What | How |
|---|---|
| Active track title/artist/album | From `loadedHash` → look up in `tracks` store |
| Artwork | `invoke<number[]>('track_get_artwork', { hash: loadedHash })` → blob URL |
| Play / pause | `invoke('audio_play')` / `invoke('audio_pause')` |
| Skip next / prev | `invoke('track_play', { hash: nextTrack.hash })` — derive from `queueSlice` |
| Seek bar | rAF loop on `positionMsRef`; drag → `invoke('audio_seek', { positionMs })` |
| Duration | `playbackSlice.durationMs` |
| Volume | `invoke('audio_set_volume', { volume })` |
| Shuffle / loop | Drive `queueSlice` shuffle; loop state lives in `playbackSlice` |
| Coverflow | Replace mock `ALBUMS` with artwork blob URLs from loaded queue tracks |
| A/B badge | Read `trackAbPoints` (localStorage, same key as desktop) |
| "Playing from" label | Active playlist name from `playlistSlice` or "Library" |

**Key detail:** `track_play` handles load + play atomically (calls `audio_load` then `audio_play` internally on the Rust side). Use it for skip; use `audio_play` / `audio_pause` only for toggling on the already-loaded track.

---

### 1.5 MiniPlayer (shared by Library, Playlists, PlaylistDetail)

**File:** `src/mobile/components/Library.tsx` → `MiniPlayer`

| What | How |
|---|---|
| Track title/artist | `loadedHash` → look up in `tracks` |
| Artwork | Blob URL from `track_get_artwork` (reuse cached value) |
| Progress bar | rAF loop writing to a DOM ref |
| Play/pause | `invoke('audio_play')` / `invoke('audio_pause')` |
| Skip next | `invoke('track_play', { hash: nextTrack.hash })` |

---

## Phase 2 — Playlist interaction

### 2.1 PlaylistDetail screen

**File:** `src/mobile/components/PlaylistDetail.tsx`

| What | How |
|---|---|
| Track list | `invoke<TrackRecord[]>('playlist_get_tracks', { playlistId, branchName })` |
| Play button | `invoke('track_play', { hash: firstTrack.hash })` + set active playlist in store |
| Active branch | From `playlist.branches.find(b => b.name === activeBranch)` |
| Playlist description | `invoke<BranchMeta>('playlist_get_meta', { playlistId, branchName })` |
| Commit button | `invoke('playlist_reorder_tracks', ...)` or `branch_append_tracks` — depends on what changed |
| Uncommitted banner | Compare tracks in current UI state vs `playlist_get_tracks` result — show if they differ |
| Track artwork | Same `track_get_artwork` pattern |

---

### 2.2 Branch picker sheet

**File:** `src/mobile/components/PlaylistDetail.tsx` → `BranchPickerSheet`

- Replace mock branch list with `playlist.branches` from `playlistSlice`
- Switching branch re-calls `playlist_get_tracks` with new `branchName`
- "Fork to new playlist" → `invoke<PlaylistWithBranches>('playlist_fork', { playlistId, newName })`
- "New branch" → `invoke('branch_create', { playlistId, branchName, fromBranch })`

---

### 2.3 Commit history sheet

**File:** `src/mobile/components/PlaylistDetail.tsx` → `HistoryView`

- Replace mock commits with `invoke<CommitRecord[]>('branch_get_history', { playlistId, branchName })`
- `CommitRecord` fields: `hash`, `message`, `timestamp`, `device_id`, `parent` — render same DAG rail
- Revert action: `invoke('branch_revert_to', { playlistId, branchName, commitHash })`

---

### 2.4 Merge sheet

**File:** `src/mobile/components/PlaylistDetail.tsx` → `MergeSheet`

- Source branch list: `playlist.branches`
- Track diff preview: compute locally — source tracks not in target = added, etc.
- Execute: `invoke<string>('branch_merge', { playlistId, targetBranch, sourceBranch, strategy, message, descriptionOverride })`
- Reload tracks after merge

---

## Phase 3 — Write operations from mobile

### 3.1 Favoriting a track (Library screen)

- Heart tap → `invoke('library_set_favorite', { hash, favorited: true })` + update store

### 3.2 Add to playlist (TrackRow context action)

- Long-press / swipe action → show playlist picker sheet
- `invoke('branch_append_tracks', { playlistId, branchName, hashes, message })`

### 3.3 Track reorder in PlaylistDetail

- Drag-to-reorder gesture (different from swipe-to-delete)
- On drop: `invoke('playlist_reorder_tracks', { playlistId, branchName, orderedHashes })`

### 3.4 A/B loop from Now Playing

- A/B button opens marker mode on the seek bar (same as desktop)
- On set: `invoke('playlist_set_ab_loop', { playlistId, branchName, trackHash, abStartMs, abEndMs })`
- On clear (drag to full range): send `null` for both values

---

## Phase 4 — Platform-specific concerns

### 4.1 Safe area insets

The mobile window runs with `decorations: false`. On a real iPhone the system status bar and home indicator eat space. Add to `.mobile-root` in `style.css`:

```css
.mobile-root {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

The tab bar's `height: 86px` already accounts for the home indicator on the dev machine — this just makes it correct on a real device.

### 4.2 Downloads (yt-dlp)

`downloader.rs` uses `std::process::Command` to run `yt-dlp`. This **will not work on iOS** (no shell, sandboxed). Options:

- **iOS:** Use the Tauri HTTP plugin to call a self-hosted server that runs yt-dlp, or display a "download on desktop and sync" message
- **Android:** `std::process::Command` should work; same desktop flow applies
- For now: hide the Downloads sheet on iOS (`platform === 'ios'`), show it only on Android and desktop

### 4.3 Settings screen

| Setting | How |
|---|---|
| Theme picker | Already wired via `applyTheme()` — just make buttons call it and persist to `localStorage` |
| Custom hue slider | `writeCustomHue(hue)` + `applyTheme('custom')` — same as desktop |
| Commit identity | `invoke<string>('get_commit_author')` on mount, `invoke('set_commit_author', { name })` on save |
| Offline storage | No Tauri command yet; show `tracks.length` track count as proxy |
| Developer mode | `localStorage` toggle; show/hide commit graph button in PlaylistDetail |

### 4.4 Discover tab (P2)

Depends on the semantic playlist generation work in `PLAN.md` P2. For now it stays as the Vibes mockup. Wire when `sqlite-vector-rs` and the embedding pipeline are in place.

---

## Invoke surface reference (mobile-relevant commands)

### Reads
| Command | Used in |
|---|---|
| `library_get_all` → `TrackRecord[]` | Library, Now Playing queue |
| `playlist_get_all` → `PlaylistWithBranches[]` | Playlists |
| `playlist_get_tracks(playlistId, branchName)` → `TrackRecord[]` | PlaylistDetail |
| `playlist_get_meta(playlistId, branchName)` → `BranchMeta` | PlaylistDetail header |
| `playlist_get_artwork(playlistId)` → `number[]` | Playlists cards |
| `track_get_artwork(hash)` → `number[]` | Library rows, NowPlaying, MiniPlayer |
| `branch_get_history(playlistId, branchName)` → `CommitRecord[]` | HistoryView |
| `get_commit_author` → `string` | Settings |

### Writes
| Command | Used in |
|---|---|
| `track_play(hash)` | NowPlaying, Library, PlaylistDetail |
| `audio_play` / `audio_pause` | NowPlaying play/pause toggle, MiniPlayer |
| `audio_seek(positionMs)` | NowPlaying seek bar |
| `audio_set_volume(volume)` | NowPlaying (no visible slider in design, but needed) |
| `library_set_favorite(hash, favorited)` | Library heart, NowPlaying heart |
| `branch_append_tracks(...)` | Add-to-playlist flow |
| `playlist_reorder_tracks(...)` | PlaylistDetail drag reorder |
| `playlist_set_ab_loop(...)` | NowPlaying A/B mode |
| `branch_merge(...)` | MergeSheet |
| `branch_create(...)` | BranchPickerSheet "New" |
| `playlist_fork(...)` | BranchPickerSheet "Fork to new playlist" |
| `branch_revert_to(...)` | HistoryView revert action |
| `set_commit_author(name)` | Settings |
| `download_enqueue(url)` | Downloads sheet (Android only) |
| `download_queue` / `download_cancel` | Downloads sheet (Android only) |

---

## Work order

Priority order based on what makes the app usable on a real device:

1. **Store mount + real Library** — `loadLibrary()` on mount, real `TrackRecord[]` in Library screen, artwork blob URLs
2. **Real Now Playing** — `loadedHash` → track info, rAF seek bar, play/pause/skip wired
3. **Real MiniPlayer** — same track info + play/pause from any tab
4. **Real Playlists list** — `playlist_get_all`, branch pills, artwork
5. **Real PlaylistDetail tracks** — `playlist_get_tracks`, play button, branch display
6. **Branch picker + History** — real branches from PlaylistRecord, `branch_get_history`
7. **Merge** — `branch_merge` with live diff preview
8. **Favoriting** — heart tap in Library/NowPlaying
9. **Settings** — commit author, theme persistence
10. **Safe area CSS** — only matters on real device; can be deferred until device testing
11. **Downloads (Android)** — gate on `platform === 'android'`
12. **Discover (AI)** — P2, depends on embedding pipeline

*Last updated: 2026-05-10.*
