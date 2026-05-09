# Melomaniac — Playback Engine Design

> This document scopes the full playback model: auto-advance, queue, shuffle, loop, and A·B. It is the implementation reference for the frontend (`DesktopApp.tsx`) and any future backend hooks.

---

## Current state (as of v0.1 Alpha)

| Feature | Status |
|---|---|
| Manual play/pause | ✅ wired |
| Skip next / skip prev | ✅ wired (no loop-mode awareness) |
| Shuffle toggle (Fisher-Yates) | ✅ wired (produces `shuffledQueue`) |
| Loop mode state (`off` / `one` / `ab`) | ✅ state exists, UI buttons wired |
| Auto-advance on `TrackEnded` | ❌ event only stops playback |
| Single-song loop enforcement | ❌ not implemented |
| A·B loop enforcement | ❌ markers shown, seek logic missing |
| Manual queue (play next / add to queue) | ❌ UI buttons are no-ops |
| Skip-prev restart threshold | ❌ always jumps to previous track |
| End-of-queue wraparound + reshuffle | ❌ not implemented |
| Shuffle algorithm choice | ❌ only one algorithm exists |

---

## 1. Queue model

Three layers, consumed in order:

```
manualQueue  →  playQueue (shuffled or ordered)
```

### 1a. `playQueue`
The primary ordered list. Derives from:
- `playlistTracks` when a playlist is active
- `trackOrder` (full library) otherwise
- When shuffle is on, `playQueue` is a shuffled permutation of the above

This is already implemented. The carousel renders from `playQueue`.

### 1b. `manualQueue`
New state: `manualQueue: Track[]`

Tracks inserted here play **before** the next natural `playQueue` item, regardless of shuffle state. Items are consumed FIFO and removed once played. Two insertion modes:
- **Play next** — prepend to front of `manualQueue`
- **Add to queue** — append to back of `manualQueue`

Both are available from the TrackList context menu (currently no-ops).

### Skip-next resolution order
1. If `manualQueue.length > 0` → pop and play the front item
2. Else → advance `currentQueueIndex` in `playQueue` (with wraparound logic below)

### Skip-prev resolution
- If `positionMs > 3000` ms → seek to 0 (restart current track), do not change index
- Else if `manualQueue` was consumed → no clean "prev" into manual queue; just go back in `playQueue`
- Else → decrement `currentQueueIndex` in `playQueue`

---

## 2. Auto-advance

On `TrackEnded` audio event, apply loop mode:

```
if loopMode === 'one':
    reload and play same track (invoke track_play with same hash)
    reset positionMs to 0

if loopMode === 'ab':
    seek back to abA * durationMs
    (TrackEnded should not fire during A·B — see §4)

if loopMode === 'off':
    advance to next track via skip-next resolution (§1)
    if at end of playQueue and manualQueue is empty:
        → wraparound + reshuffle (see §3)
```

### Implementation note
`TrackEnded` fires inside a `listen()` callback that captures a stale closure over `playQueue` and `loopMode`. These must be read via refs (like `loadedHash` already uses `lastSeekTime.current`) to avoid stale values:
- `loopModeRef`
- `playQueueRef`
- `loadedHashRef`
- `manualQueueRef`

---

## 3. End-of-queue wraparound and reshuffle

When `loopMode === 'off'` and the last track in `playQueue` finishes with `manualQueue` empty:

1. If shuffle is **off**: wrap `currentQueueIndex` back to 0, play first track
2. If shuffle is **on**:
   - Re-run the active shuffle algorithm over `activeQueue` to produce a new `shuffledQueue`
   - The new first track must **not** be the same as the track that just ended (swap if needed — a single swap is sufficient)
   - Reset `currentQueueIndex` to 0, play the new first track

This mirrors Apple Music / Spotify behaviour: infinite play with a fresh shuffle order each cycle.

---

## 4. Shuffle algorithms

Expose as a setting: `shuffleMode: 'fisher-yates' | 'random' | 'balanced'`

### Fisher-Yates (default)
True shuffle — every track plays exactly once before any repeats. The permutation is computed once when shuffle is toggled on, and again on each end-of-queue wraparound.

```ts
function fisherYates(arr: Track[]): Track[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

Current `handleShuffle` uses `[...activeQueue].sort(() => Math.random() - 0.5)` — this is biased (not a true Fisher-Yates). Replace with the above.

### Random
Picks the next track uniformly at random from `activeQueue` on every advance, independent of history. Can repeat tracks. Useful for very large libraries where "no repeats" feels constraining.

When random mode is active there is no `shuffledQueue` to precompute — next track is chosen at advance time. `currentQueueIndex` is meaningless; skip-prev in random mode restarts the current track (no back-navigation).

### Balanced spread (Spotify-style)
Spotify's algorithm, described in their 2014 engineering post ("How to shuffle songs" — Lukáš Poláček). Pure Fisher-Yates is mathematically uniform but *perceptually* clumpy: with the birthday paradox, even a 20-track playlist with 4 same-artist tracks will produce back-to-back same-artist plays surprisingly often. Users experience this as "broken" shuffle.

The balanced algorithm:
1. Group tracks by artist
2. Assign each group evenly-spaced target positions across the output list (round-robin slot assignment)
3. Add a small uniform random offset within each slot to break the mechanical pattern

Result: same-artist tracks are spread as far apart as possible while still feeling random. Sacrifices mathematical uniformity for perceptual evenness. Particularly effective when the library is artist-diverse.

```ts
function balancedShuffle(tracks: Track[]): Track[] {
  // Group by artist
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = t.artist || '?';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  // Shuffle within each group
  const shuffledGroups = [...groups.values()].map(fisherYates);
  // Interleave: assign each track a target slot with jitter
  const n = tracks.length;
  const result: { track: Track; pos: number }[] = [];
  for (const group of shuffledGroups) {
    const spacing = n / group.length;
    const offset = Math.random() * spacing;
    group.forEach((t, i) => {
      result.push({ track: t, pos: offset + i * spacing + (Math.random() - 0.5) * spacing * 0.4 });
    });
  }
  result.sort((a, b) => a.pos - b.pos);
  return result.map(r => r.track);
}
```

Falls back gracefully to Fisher-Yates when all tracks are by the same artist.

### UI
Add a second click-state to the shuffle button, or a long-press / right-click menu:
- `off` → grey
- `fisher-yates` → accent colour (classic shuffle icon)
- `random` → accent colour, dice icon (or different tooltip)
- `balanced` → accent colour, wave/spread icon

---

## 5. Loop modes

### `off`
Default. Auto-advance to next track on `TrackEnded`.

### `one` — Single track loop
On `TrackEnded`: re-invoke `track_play` with the same hash, reset `positionMs` to 0. The native backend already stops the stream on track end; we must reload it.

### `ab` — A·B region loop
The seek bar shows two draggable handles, A and B, as fractions of `durationMs`. The loop must be enforced in the **frontend** by monitoring `positionMs`:

```
on every PositionChanged event:
    if loopMode === 'ab' and durationMs > 0:
        const aMs = abA * durationMs
        const bMs = abB * durationMs
        if positionMs >= bMs:
            seek to aMs
```

This requires the `PositionChanged` handler in the `listen('audio://event')` effect to read `loopMode`, `abA`, `abB`, and `durationMs` via refs (same stale-closure concern as §2).

Constraints on handle placement:
- A must be < B − some minimum gap (suggest 500 ms minimum)
- A ≥ 0, B ≤ durationMs

A·B is a sub-mode — when the user exits A·B (cycles loop mode away from `ab`), the handles are preserved so they can return to the same region.

---

## 6. `currentQueueIndex` tracking

Currently the app locates the "current position" in `playQueue` by searching for `loadedHash` each time. This works but is O(n) and fragile if the same track appears twice.

Introduce `currentQueueIndex: number` (ref, not state — no re-render needed) that is updated whenever a track loads:
- On `handleTrackPlayPause`: set to `playQueue.findIndex(t => t.id === id)`
- On skip next/prev: increment/decrement
- On manual queue pop: leave index unchanged (next natural track is still at `currentQueueIndex + 1`)
- On reshuffle: reset to 0

---

## 7. Known bugs

### Skip next/prev don't move the carousel
`handleSkipNext` and `handleSkipPrev` locate their current position via `playQueue.findIndex(t => t.hash === loadedHash)`. If `loadedHash` is null (nothing has been played yet) or the loaded track is not in the current queue, `idx === -1` and the handlers return immediately — the carousel never moves and no track loads.

**Fix:** fall back to `playQueue.findIndex(t => t.id === activeTrackId)` when `loadedHash` is not found, so skipping works from any selection state.

---

## 8. Implementation order

1. **Fix Fisher-Yates** — replace the biased sort in `handleShuffle`
2. **Stale-closure refs** — add `loopModeRef`, `playQueueRef`, `loadedHashRef`, `manualQueueRef`, keep them in sync via `useEffect`
3. **`currentQueueIndex` ref** — replace `findIndex(loadedHash)` calls in skip handlers
4. **Auto-advance** — wire `TrackEnded` to call `handleSkipNext` (after refs are correct), with single-song loop short-circuit
5. **Skip-prev restart threshold** — check `positionMs > 3000` before going back
6. **A·B enforcement** — add branch to `PositionChanged` handler
7. **Manual queue state + UI** — `manualQueue` state, wire "Add to queue" and "Play next" in TrackList context menu, add queue panel/popover
8. **Wraparound + reshuffle** — detect end-of-queue in auto-advance, reshuffle if needed
9. **Shuffle algorithm choice** — add `shuffleMode` to `AppSettings`, expose in SettingsModal, implement random mode

---

## 9. Data structures summary

| Name | Type | Where | Purpose |
|---|---|---|---|
| `playQueue` | `Track[]` | state (derived) | Current ordered or shuffled source |
| `manualQueue` | `Track[]` | state | Tracks inserted by user for immediate playback |
| `currentQueueIndex` | `number` | ref | Position in `playQueue` |
| `loopModeRef` | `ref<LoopMode>` | ref | Stale-closure-safe loop mode for event handlers |
| `playQueueRef` | `ref<Track[]>` | ref | Stale-closure-safe queue for event handlers |
| `loadedHashRef` | `ref<string\|null>` | ref | Stale-closure-safe loaded hash |
| `manualQueueRef` | `ref<Track[]>` | ref | Stale-closure-safe manual queue |
| `shuffleMode` | `'fisher-yates'\|'random'\|'balanced'` | settings | Algorithm used when shuffle is on |

*Last updated: 2026-05-09.*
