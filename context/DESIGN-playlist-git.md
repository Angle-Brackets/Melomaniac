# Melomaniac — Playlist-as-Git-Repository Design

> How the CAS + commit graph gives every playlist a full version history,
> branching, and eventual merging — modelled directly on git's object model.

---

## 1. The object model

Everything persistable is a CAS blob identified by its BLAKE3 hash. There are
three blob types, exactly mirroring git:

```
git concept     Melomaniac equivalent         Stored as
──────────────  ────────────────────────────  ──────────────────────────────
blob            audio file bytes              CAS object (binary)
tree            ordered track list + AB pts   CAS object (JSON, see §2)
commit          snapshot pointer + metadata   CAS object (JSON, see §3)
branch ref      head_commit in branches table SQLite (fast pointer lookup)
tag             (not yet implemented)         —
```

The `tracks` SQLite table is **not** part of the version history. It is a
mutable index of known track metadata (title, artist, duration, etc.) keyed by
audio hash. Think of it as git's pack index: an acceleration structure, not
the source of truth. The tree blob is the source of truth for playlist order;
the `tracks` table just makes it cheap to look up display metadata without
reading every audio blob.

---

## 2. Tree blob format

A tree blob is the snapshot of a playlist at a point in time. It is a JSON
object stored as a CAS blob:

```json
{
  "tracks": [
    { "hash": "4fa9b0c2…", "ab_start_ms": null,  "ab_end_ms": null  },
    { "hash": "7e3c18d4…", "ab_start_ms": 12000, "ab_end_ms": 95000 },
    { "hash": "a1b2c3d4…", "ab_start_ms": null,  "ab_end_ms": null  }
  ]
}
```

**The array order IS the playlist order.** This is the key difference from
git trees (which are unordered by name). A reorder produces a new tree blob
with the same hashes in a different sequence — the audio blobs themselves are
untouched, just like git doesn't copy file bytes when you rename a file.

`ab_start_ms` / `ab_end_ms` are per-track A/B loop points, saved into the
commit so they travel with the playlist history.

The tree hash is computed from the JSON bytes, so identical orderings (even
across different sessions or devices) produce the same hash — natural
deduplication of no-op commits.

---

## 3. Commit blob format

```json
{
  "tree_hash":  "9c2a31f0…",
  "parent":     "b7f19244…",
  "timestamp":  1746300000,
  "device_id":  "laptop-main",
  "message":    "Reorder: ambient tracks to top"
}
```

Root commits have `"parent": null`. Merge commits will have two parents (stored
via the `commit_parents` table, not this JSON, because JSON can't easily express
a variable list without breaking the hash).

The commit is hashed like everything else — the commit hash is the BLAKE3 of
this JSON. Identical commits (same tree, same parent, same timestamp, same
device) produce the same hash, which makes sync idempotent.

---

## 4. The reference graph

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

Reading current playlist state:
```
branches.head_commit
    → commits.tree_hash
        → CAS: read tree blob JSON
            → [{ hash, ab_start_ms, ab_end_ms }, …]
                → db.get_track(hash) for each entry
                    → Vec<TrackRecord> in playlist order
```

---

## 5. Working tree and dirty state

The "working tree" is the in-memory `trackOrder: Track[]` state in React. It
starts as the committed HEAD state on load and diverges when the user reorders.

```
HEAD commit (committed)
    │
    │  user drags row → trackOrder changes
    ▼
Working tree (dirty)    hasUncommitted = true

    user clicks "Commit reorder"
    │
    ├── frontend sends track_hashes (ordered) to backend
    ├── backend writes tree blob → tree_hash
    ├── backend writes commit blob → commit_hash
    ├── backend advances branch.head_commit → commit_hash
    └── hasUncommitted = false, UI shows new commit in graph
```

There is no staging area — any reorder is implicitly "staged" and the user
commits the whole working tree at once. This matches git's `git commit -a`
model and is appropriate for a playlist (you're always committing the full
ordered list, not individual file diffs).

---

## 6. New Tauri commands required

### `playlist_get_head_tracks(playlist_id, branch_name) → Vec<TrackRecord>`

The read path. Resolves branch → HEAD commit → tree blob → ordered
`TrackRecord` list. Returns an empty vec if the branch has no commits yet
(new playlist).

```rust
// Pseudocode
let branch   = db.get_branch(playlist_id, branch_name).await?;
let commit   = db.get_commit(&branch.head_commit?).await?;
let tree_json = cas.read_blob(&commit.tree_hash).await?;
let tree: TreeBlob = serde_json::from_slice(&tree_json)?;
let records  = join_all(tree.tracks.iter().map(|e| db.get_track(&e.hash))).await?;
// preserve order, attach ab_start_ms / ab_end_ms from tree entry
```

### `playlist_commit_tracks(playlist_id, branch_name, entries, device_id, message) → String`

Higher-level write path. Takes `Vec<{ hash, ab_start_ms, ab_end_ms }>` from the
frontend — builds the tree JSON, hashes it, creates the commit, advances HEAD.
Returns the new commit hash.

This replaces the existing `branch_commit` as the frontend-facing API.
`branch_commit` stays as an internal function used by `playlist_commit_tracks`.

### `playlist_checkout(playlist_id, commit_hash) → Vec<TrackRecord>`

Read tracks from any past commit without changing the branch pointer.
Used for history browsing (the commit graph "click to preview" feature).
Does NOT update `head_commit` — the UI is in "detached HEAD" read-only mode.

### `playlist_diff(commit_a, commit_b) → PlaylistDiff`

Compares two tree blobs and returns a structured diff:

```rust
pub struct PlaylistDiff {
    pub added:    Vec<TrackRecord>,   // in b but not in a
    pub removed:  Vec<TrackRecord>,   // in a but not in b
    pub reordered: bool,              // same set, different order
    pub ab_changed: Vec<TrackRecord>, // AB points changed
}
```

Used to annotate commit nodes in the commit graph UI ("+ 2 tracks, reordered").

### `playlist_log(playlist_id, branch_name, limit) → Vec<CommitSummary>`

Wraps `get_commit_history` with richer output per commit: the commit record
plus the diff summary so the graph can show per-commit annotations without
a separate call.

```rust
pub struct CommitSummary {
    pub commit: CommitRecord,
    pub diff:   PlaylistDiff,   // vs. parent (empty for root)
}
```

---

## 7. HEAD tracking

Currently the "active branch" is implicit (hardcoded to `main` in the mock UI).
It needs to be persisted per playlist so that after an app restart the user
returns to the same branch they were on.

**Option A — Extra SQLite column:**
```sql
ALTER TABLE playlists ADD COLUMN active_branch TEXT NOT NULL DEFAULT 'main';
```
Simple. A new command `playlist_set_active_branch(playlist_id, name)` is called
when the user switches branches.

**Option B — In-memory app state only:**
`activePlaylistBranch: Record<playlistId, branchName>` in React state, reset
to `'main'` on restart. Simpler — no migration. Fine for now.

Option B is recommended until branch switching is actually wired in the UI.

---

## 8. Branching workflow

```
main:   A──B──C──────────────F (merge)
                  \          /
dev:               D──E────/
```

1. User clicks "New Branch from HEAD" (`branch_create` already exists).
2. New branch pointer is set to current `head_commit`.
3. Commits on `dev` diverge from `main`. Each branch's `head_commit` advances
   independently.
4. Merge: both sets of tracks are unioned. Track order conflicts (same track at
   different positions) require a resolution strategy — see §9.

---

## 9. Merging

A merge commit has two parents. The merge algorithm works on the two tree blobs:

**No conflicts** (branches added different tracks, neither reordered shared
tracks): auto-merge produces a new tree that concatenates the additions.

**Reorder conflict** (both branches moved the same track to different positions):
Melomaniac cannot resolve this automatically without semantic knowledge.
Two options:

- **Ours / Theirs**: take one branch's order wholesale, append unique tracks
  from the other. Fast but lossy.
- **Automerge CRDT** (P2 plan): represent playlist order as a sequence CRDT
  (Logoot or YATA). Each insert/move is a positional op; concurrent ops
  converge to the same order deterministically. Requires storing positional
  metadata per entry in the tree blob.

For the initial implementation: Ours/Theirs merge, with a conflict UI that
shows both orderings and lets the user pick.

---

## 10. What the frontend needs to change

The desktop UI currently treats `trackOrder: Track[]` as its own independent
state initialised from mock constants. With the real storage layer:

| Current | With real storage |
|---|---|
| `useState(TRACKS)` | `useState([])` + load from `playlist_get_head_tracks` on mount |
| `activeTrackId: number` | `activeTrackId: string` (hash) |
| `hasUncommitted` flag | same, but commit calls `playlist_commit_tracks` |
| Discard reorder → reset to `TRACKS` | Discard → re-call `playlist_get_head_tracks` |
| CommitGraph uses mock `COMMITS` | Load from `playlist_log` |
| Branch modal is cosmetic | `branch_create` + `playlist_set_active_branch` |
| History tab is static | `playlist_checkout(commitHash)` for selected node |

The `Album[]` carousel data also gets replaced: `playlist_get_head_tracks`
returns `TrackRecord[]` with `artwork_hash`; the carousel builds its gradient
art from artwork blobs (or falls back to the generated gradients).

---

## 11. Invariants to enforce

- **No empty commits**: if the tree hash equals the parent's tree hash, the
  commit is a no-op. `playlist_commit_tracks` should return the existing commit
  hash rather than writing a duplicate.
- **Audio blob must exist before commit**: `playlist_commit_tracks` should
  verify each hash is present in the CAS before writing the tree blob. Returns
  `Err` with the missing hash if not.
- **Track record must exist**: same check against the `tracks` table. A track
  can be in a playlist tree only if its metadata is indexed.
- **Branch pointer only advances**: `head_commit` is only moved forward by
  normal commits. Reverting to a prior commit creates a **new** commit whose
  tree equals the old one — the history is never rewritten (same model as `git
  revert`, not `git reset --hard`).

---

*Last updated: 2026-05-03.*
