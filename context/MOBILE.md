# Melomaniac — Mobile UI Wiring

> Scope document for connecting the mobile React screens (`src/mobile/`) to the real Tauri backend and shared Zustand store. All Tauri commands already work on iOS (confirmed on device). **All phases below are complete — the mobile UI is fully wired to the real backend; mock data from `src/mobile/data.ts` has been retired.**

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

## Phase 1 — Read-only wiring (show real data) ✓ Complete

### 1.1 Shared store mount ✓

**File:** `src/mobile/MobileApp.tsx`

- [x] Call `loadLibrary()` and `loadPlaylists()` in `useEffect` on mount
- [x] Pass `isPlaying`, `loadedHash`, active track info down to `MiniPlayer` and `NowPlaying`

---

### 1.2 Library screen ✓

**File:** `src/mobile/components/Library.tsx`

- [x] Track list — `useStore(s => s.tracks)` populated by `library_get_all`
- [x] Track artwork — `invoke<number[]>('track_get_artwork', { hash })` → blob URL
- [x] Favorites filter — `useStore(s => s.tracks.filter(t => t.favorited))`
- [x] Search — client-side filter on `title`/`artist`/`album`
- [x] MiniPlayer — real state (see §1.5)
- [x] Mock `TRACKS` import retired; `TrackRow` accepts `TrackRecord`

---

### 1.3 Playlists screen ✓

**File:** `src/mobile/components/Library.tsx` → `PlaylistsList`

- [x] Playlist list — `useStore(s => s.playlists)` — `PlaylistWithBranches[]`
- [x] Playlist artwork — `invoke<number[]>('playlist_get_artwork', { playlistId })` → blob URL
- [x] Branch info — eager-loaded from `playlist.branches`; active branch name + count shown
- [x] HEAD commit hash — `branches[0].head_commit?.slice(0, 6)`

---

### 1.4 Now Playing screen ✓

**File:** `src/mobile/components/NowPlaying.tsx`

- [x] Active track title/artist/album from `loadedHash` → store lookup
- [x] Artwork via `track_get_artwork`
- [x] Play / pause — `invoke('audio_play')` / `invoke('audio_pause')`
- [x] Skip next / prev — derived from `queueSlice`
- [x] Seek bar — rAF loop on `positionMsRef`; drag → `invoke('audio_seek', { positionMs })`
- [x] Duration from `playbackSlice.durationMs`
- [x] Shuffle / loop wired to store
- [x] Coverflow — real artwork blob URLs from loaded queue tracks
- [x] A/B badge — reads `trackAbPoints` from localStorage
- [x] "Playing from" label — active playlist name or "Library"

---

### 1.5 MiniPlayer (shared by Library, Playlists, PlaylistDetail) ✓

**File:** `src/mobile/components/Library.tsx` → `MiniPlayer`

- [x] Track title/artist from `loadedHash` → store lookup
- [x] Artwork blob URL from `track_get_artwork` (cached)
- [x] Progress bar — rAF loop writing to DOM ref
- [x] Play/pause and skip next wired

---

## Phase 2 — Playlist interaction ✓ Complete

### 2.1 PlaylistDetail screen ✓

**File:** `src/mobile/components/PlaylistDetail.tsx`

- [x] Track list — `invoke<TrackRecord[]>('playlist_get_tracks', { playlistId, branchName })`
- [x] Play button — `invoke('track_play', { hash: firstTrack.hash })` + active playlist set in store
- [x] Active branch from `playlist.branches`
- [x] Playlist description via `playlist_get_meta`
- [x] Uncommitted banner wired
- [x] Track artwork via `track_get_artwork`

---

### 2.2 Branch picker sheet ✓

**File:** `src/mobile/components/PlaylistDetail.tsx` → `BranchPickerSheet`

- [x] Real branch list from `playlist.branches`
- [x] Branch switch re-calls `playlist_get_tracks`
- [x] Fork and new branch actions wired

---

### 2.3 Commit history sheet ✓

**File:** `src/mobile/components/PlaylistDetail.tsx` → `HistoryView`

- [x] Real commits from `branch_get_history`
- [x] Revert action wired

---

### 2.4 Merge sheet ✓

**File:** `src/mobile/components/PlaylistDetail.tsx` → `MergeSheet`

- [x] Live branch list and track diff preview
- [x] `branch_merge` wired; tracks reload after merge

---

## Phase 3 — Write operations from mobile ✓ Complete

### 3.1 Favoriting a track ✓

- [x] Heart tap → `invoke('library_set_favorite', { hash, favorited })` + store update

### 3.2 Add to playlist ✓

- [x] Long-press / swipe → playlist picker sheet → `branch_append_tracks`

### 3.3 Track reorder in PlaylistDetail ✓

- [x] Drag-to-reorder → `invoke('playlist_reorder_tracks', ...)`

### 3.4 A/B loop from Now Playing ✓

- [x] A/B marker mode on seek bar; `playlist_set_ab_loop` wired; clear sends `null`

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

## Work order ✓ Complete

All items 1–9 are done. Remaining items:

- **Safe area CSS (4.1)** — verify on real device; home indicator padding may need tuning
- **Downloads (Android)** — gate on `platform === 'android'`; not applicable until Android target lands
- **Discover (AI)** — P2, depends on embedding pipeline

---

## a1.0.1 Polish

Post-wiring visual and UX fixes shipped in the a1.0.1 pass:

- **Filled icon states for active secondary buttons** — heart, shuffle, and loop buttons now render a filled icon variant when active instead of an outline circle
- **Theme-aware icon colors** — all secondary buttons (heart, shuffle, loop) use the CSS `--accent` variable; no longer influenced by the dynamic album art palette
- **Radial long-press shuffle menu** — holding the shuffle button opens a radial picker to choose between Off / Normal / Weighted / Discovery shuffle modes
- **Rounded queue panel corners** — the floating queue panel now has rounded top corners matching the bottom-sheet style
- **AVAudioSession interruption resume** — playback automatically resumes after iOS audio session interruptions (phone calls, Siri, other audio apps)
- **Inline queue rounded top corners** — the inline queue view inside NowPlaying also has rounded top corners for visual consistency

*Last updated: 2026-06-16.*
