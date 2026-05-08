# Melomaniac — Playlist System Design

> Scope: what the backend supports today, gap analysis for requested features, and the implementation plan.

---

## Current Backend Model

### Data model (as-built)

```
playlists          branches               commits           commit_parents
──────────         ──────────             ───────           ──────────────
id (PK)            id (PK)                hash (PK)         commit_hash → commits
name               playlist_id → playlists tree_hash        parent_hash → commits
description        name                   timestamp
created_at         head_commit → commits  device_id
forked_from → self UNIQUE(playlist_id,name) message
```

Each **branch HEAD** points at a **commit**. Each **commit** points at a **tree blob** stored in CAS. A tree blob is a JSON document:

```json
{
  "tracks": [
    { "hash": "<blake3>", "ab_start_ms": null, "ab_end_ms": null }
  ]
}
```

`commit_parents` is a multi-row join: root commits have 0 rows, normal commits have 1, and merge commits have 2. The schema already anticipates merges.

### Tauri commands (as-built)

| Command | What it does |
|---|---|
| `playlist_get_all` | All playlists + their branches |
| `playlist_create` | New playlist with a `main` branch (no commits) |
| `playlist_fork` | Copy playlist + all its branches (shared history) |
| `branch_create` | New branch from optional commit |
| `branch_commit` | Write tree JSON → CAS, advance HEAD |
| `branch_append_tracks` | Load current tree, add hashes, commit |
| `branch_get_history` | First-parent walk from HEAD |
| `get_recent_commits` | Most recent commits across all branches |
| `library_get_stray_tracks` | Hashes not referenced in any active tree |

### What's missing for a working UI (before any new features)

- **`playlist_get_tracks(playlist_id, branch_name)`** — read HEAD commit → tree blob → resolve to `TrackRecord[]`. Nothing currently turns a branch HEAD into a track list on the frontend.
- **Active branch per playlist** — the model has many branches but no concept of "which one is selected". For now, "active branch" is UI state (default to `main`).
- **`playlist_remove_track` / `playlist_reorder_tracks`** — remove a hash from the tree and commit; reorder tracks in the tree and commit.
- **`playlist_delete`** / **`playlist_rename`** — DB functions exist but no Tauri command is exposed.
- **`artwork_hash` column missing from `playlists` table** — needs migration `0007_add_playlist_artwork.sql`.
- **`playlist_set_artwork` / `playlist_get_artwork`** — write image bytes to CAS, update `playlists.artwork_hash`; read back raw bytes.

---

## Feature: Branching

### What's already there
- `branches` table, `branch_create` command, `branch_get_history` command.
- Any commit can be a branch point (`from_commit` arg to `branch_create`).

### Gaps
1. No command to **list tracks on a branch** — need `playlist_get_tracks`.
2. No command to **switch active branch** — pure UI state, no backend change needed.
3. No command to **delete a branch** — trivial DB delete, needs a Tauri command.
4. No **branch rename** command.

### Implementation needed
```
playlist_get_tracks(playlist_id, branch_name) → TrackRecord[]
branch_delete(playlist_id, branch_name) → ()
branch_rename(playlist_id, old_name, new_name) → ()
```

`playlist_get_tracks` algorithm:
1. Get branch HEAD commit hash.
2. Read commit blob from CAS → extract `tree_hash`.
3. Read tree blob from CAS → parse `tracks` array.
4. Resolve each `hash` against the `tracks` DB table → `TrackRecord[]`.
5. Return in tree order (not DB order).

---

## Feature: Merging

### What's already there
- `commit_parents` supports two parents — the schema is merge-ready.
- `branch_commit` accepts any tree JSON, so the merge result just needs to be serialised and passed in.

### What merging means for a playlist
Branches diverge after a fork or a `branch_create`. A merge produces a new commit whose tree is the **union** of both branches' current trees, with a two-parent commit record.

**Merge strategy — union (recommended default):**
- Start with the target branch's track list (preserves order).
- Append any tracks from the source branch that aren't already in the target.
- No "conflicts" in the traditional sense — order conflicts are resolved by keeping target order and appending new tracks at the end.

**Merge strategy — intersection (optional):**
- Only keep tracks that appear in both branches.
- Useful for "I want only the songs we both agreed on."

**Merge strategy — diff (optional, later):**
- Show the user what changed between the two trees and let them pick.

### Implementation needed
```
branch_merge(
  playlist_id,
  target_branch,   // branch to merge INTO (its HEAD advances)
  source_branch,   // branch to merge FROM
  strategy,        // "union" | "intersection"
  message,
) → commit_hash
```

Algorithm (union):
1. Resolve target HEAD → track hash list T.
2. Resolve source HEAD → track hash list S.
3. Merged list = T + (S − T) in order.
4. Write merged tree blob → CAS.
5. Write merge commit with parents = [target HEAD, source HEAD].
6. Advance target branch HEAD.

No new DB schema needed — `commit_parents` already handles two parents.

---

## Feature: Sublists (Playlist Includes)

This is the "submodule" analogy: playlist A embeds a reference to playlist B, so A's resolved track list includes B's tracks at a specific position (or appended). When B is updated, A can either stay pinned to an old snapshot or auto-track B's branch HEAD.

### Why the CAS model handles this cleanly
Because tree blobs are content-addressed, a pinned sublist reference is just a commit hash. That's immutable. A tracking reference (always-latest) is a `(playlist_id, branch_name)` tuple resolved at read time.

### Proposed tree blob schema extension (v2)

```json
{
  "v": 2,
  "meta": {
    "name":         "Study Beats",
    "description":  "Focus music for deep work",
    "artwork_hash": "<blake3-of-artwork-or-null>"
  },
  "tracks": [
    { "hash": "<blake3>", "ab_start_ms": null, "ab_end_ms": null }
  ],
  "includes": [
    {
      "playlist_id":   "<uuid>",
      "branch":        "main",
      "pinned_commit": null
    }
  ]
}
```

- `pinned_commit: null` → tracks branch HEAD at read time (like a symlink).
- `pinned_commit: "<hash>"` → frozen snapshot of that playlist at that commit (like a git submodule).
- `includes` is appended after `tracks` when resolving; order within `includes` is significant.
- Old tree blobs without `includes` are unaffected — the field is simply absent.

### Circular reference protection
When resolving, pass a `visited: HashSet<(playlist_id, branch)>` set. If a sublist is already in the set, skip it and log a warning. This prevents A→B→A infinite loops.

### Gaps / what needs to be built
1. **No DB schema change needed** — `includes` lives entirely in the CAS blob JSON.
2. **`playlist_add_include` command** — load current tree, push to `includes[]`, commit.
3. **`playlist_remove_include` command** — remove from `includes[]`, commit.
4. **`playlist_pin_include` command** — set `pinned_commit` to the source branch's current HEAD.
5. **`playlist_get_tracks` must expand includes recursively** (with cycle guard).

### Implementation needed
```
playlist_add_include(
  playlist_id,
  branch_name,
  source_playlist_id,
  source_branch,       // default "main"
  pin_to_current,      // if true, resolve HEAD now and write pinned_commit
) → commit_hash

playlist_remove_include(playlist_id, branch_name, source_playlist_id) → commit_hash
playlist_pin_include(playlist_id, branch_name, source_playlist_id) → commit_hash
playlist_unpin_include(playlist_id, branch_name, source_playlist_id) → commit_hash
```

---

## Feature: Revert to Past Commit

Already possible — `branch_commit` can write any tree. Reverting is:
1. Load tree blob from any historical commit.
2. Write it as a new commit with the current HEAD as parent ("revert commit").
3. Advance HEAD.

This gives a clean non-destructive history (like `git revert`, not `git reset --hard`).

No new backend logic needed — just a `branch_revert_to(playlist_id, branch_name, target_commit_hash)` convenience command to wire up in the UI.

---

## Commit Strategy

### Auto-commit (silent, immediate, no user interaction)

These operations are high-frequency or trivially reversible. They write a commit directly without staging.

| Operation | Generated message |
|---|---|
| Reorder tracks | `"Reorder: moved '{title}' to position {n}"` |
| Set A/B loop points | `"Set A/B: {title}"` |

### Acknowledged (staged, requires user confirmation before committing)

These operations change *what is in the playlist* or its identity. They land in the **staging area** first.

| Operation | Pre-filled message |
|---|---|
| Add tracks | `"Add: '{title}', '{title}', +{n} more"` |
| Remove tracks | `"Remove: '{title}', +{n} more"` |
| Clear all tracks | `"Clear playlist"` |
| Rename playlist | `"Rename: '{old}' → '{new}'"` |
| Set / change artwork | `"Set artwork"` |
| Merge branch | `"Merge '{source}' into '{target}'"` |
| Revert to commit | `"Revert to {short_hash}: {original_message}"` |

### The Staging Area

Rather than a blocking modal per action, acknowledged operations accumulate in a **per-playlist staging area** — a lightweight list of pending changes that lives in React state (and later optionally persisted to SQLite as a `pending_changes` table).

**UX model:**
- An acknowledged action executes optimistically in the UI (track appears/disappears immediately).
- A **commit bar** slides up at the bottom of the affected playlist view showing:
  - A summary line per pending change, each with an editable message field (pre-filled).
  - A "Commit" button and a "Discard all" button.
- The bar persists across navigation — if you go to the Library and come back, it's still there.
- Multiple acknowledged actions on the same playlist before committing are **batched into one commit**, with a single combined message (e.g. `"Add: 'Bohemian Rhapsody'; Remove: 'Stairway to Heaven'"`), or the user edits the message to whatever they want.
- "Discard all" rolls back the optimistic UI changes and clears the staging area — no commit is written.

**Why not a global staging area across all playlists?**  
Commits are per-branch-per-playlist. A cross-playlist staging panel would need to commit separately to each affected playlist anyway. Keeping it per-playlist is simpler and matches where the user's attention already is. A future "pending changes" indicator in the sidebar (a dot next to playlist names with staged changes) is enough global visibility.

---

## Sync Model: What Must Live in the Commit Graph

### The problem with SQL-only metadata

If `name`, `description`, and `artwork_hash` only live in the `playlists` SQLite table, they are device-local. When a phone and a PC sync their commit chains, the CAS graph transfers perfectly — but there's no mechanism to transfer the playlist name or artwork, because those never entered the graph. Last-write wins with no history, no conflict resolution, and no way to revert.

This applies equally to the planned upstream remote model: a push/pull transfers CAS blobs and branch HEAD refs. If the playlist's identity metadata isn't in the blobs, the remote can never know about it.

### The fix: meta section in the tree blob

Everything that must be consistent across devices belongs in the tree blob. Add a `meta` object alongside `tracks` and `includes`:

```
name, description, artwork_hash  →  tree blob meta section  (authoritative)
playlists SQL table columns       →  materialized cache       (fast queries)
```

The SQL columns (`name`, `description`, `artwork_hash`) still exist, but they are a read cache rebuilt by the indexer from the latest commit's tree blob whenever:
- A new commit is written locally.
- A sync pull lands new commits from a remote.
- The app starts up (reconciler already runs at launch).

This is how git works: objects (blobs, trees, commits) are authoritative; refs and local config are derived state.

### Consequences

**Rename and set artwork are now always commits.** That's already the plan (acknowledged actions), but the reason is now load-bearing: a rename that doesn't commit never reaches another device.

**Playlist creation writes the first commit.** `playlist_create` can no longer leave a branch with no commits — it must write an initial commit whose tree blob contains `meta.name` and empty `tracks: []`. This replaces the current pattern where new playlists start with `head_commit = NULL`.

**The `playlists` SQL table no longer needs `artwork_hash` added as a migration** for correctness — it's needed only as a cache column. Migration `0007` still runs, but its purpose is query performance, not storage authority.

**Remote push/pull works without any extra protocol.** Pull all reachable CAS blobs from the remote's branch HEAD, fast-forward (or merge) the local branch. The indexer then rebuilds `name`/`artwork_hash` from the new HEAD. The sync layer doesn't need to know anything about metadata — it's all just blobs.

### Conflict resolution for meta fields

If two devices both rename a playlist before syncing, they've produced two divergent commits. This resolves the same way a track-list conflict does: the branches have diverged, and a merge is needed. The merge strategy for `meta` fields is **last-commit-wins** — the merge commit takes `meta` from the branch with the later timestamp. Unlike track lists (where a union makes sense), a playlist can only have one name; no user interaction needed.

---

## Schema Evolution & Backwards Compatibility

### The core risk

Tree blobs are immutable CAS objects — once written, they never change. The risk is not in reading old blobs (missing fields → use defaults), but in **round-tripping**: when a client reads an old blob and writes a new one (e.g. after a reorder), it must not silently strip fields it doesn't recognise. Without protection, a client that predates `includes` would drop all sublist references the next time it rewrites the tree.

### Rules

1. **Never rename or remove a field.** Only add new optional fields. If a field's semantics need to change, deprecate it and add a new one.
2. **All new fields must be optional with a sensible default.** `ab_start_ms: null`, `includes: []`, etc.
3. **Version the schema explicitly** — a top-level `"v"` integer. Start at `1`. Bump only for genuinely breaking changes that require a migration function. Additive-only changes within a version are always safe.
4. **Unknown field passthrough** — when deserialising a tree blob in Rust, capture unrecognised fields and re-emit them on serialise. This means a v1-era client rewriting a v2 blob (e.g. after a reorder) preserves the `includes` it didn't understand.

### Rust implementation pattern

Both `TreeBlob` and `TrackEntry` should use `#[serde(flatten)] extra` to preserve unknown fields:

```rust
#[derive(Serialize, Deserialize, Default)]
struct PlaylistMeta {
    name:         String,
    #[serde(default)]
    description:  Option<String>,
    #[serde(default)]
    artwork_hash: Option<String>,

    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct TreeBlob {
    #[serde(default = "tree_blob_v1")]
    v: u32,

    #[serde(default)]                  // absent in v1 blobs → default empty meta
    meta: PlaylistMeta,

    tracks: Vec<TrackEntry>,

    #[serde(default)]                  // absent in v1 blobs → empty vec
    includes: Vec<IncludeEntry>,

    #[serde(flatten)]                  // unknown fields preserved on round-trip
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct TrackEntry {
    hash:         String,
    #[serde(default)]
    ab_start_ms:  Option<u64>,
    #[serde(default)]
    ab_end_ms:    Option<u64>,

    #[serde(flatten)]                  // future per-track fields preserved too
    extra: serde_json::Map<String, serde_json::Value>,
}

fn tree_blob_v1() -> u32 { 1 }
```

### What each version boundary means

| v | Changes | Migration needed? |
|---|---|---|
| 1 | Initial: `tracks[]` with `hash`, `ab_start_ms`, `ab_end_ms` | — |
| 2 | Add `meta` (name, description, artwork_hash) + `includes[]` | No — absent fields → defaults |
| future | Any additive field | No — same pattern |
| breaking | Rename/remove/type-change a field | Yes — bump v, write migration fn |

### Per-track fields policy

Any playlist-specific per-track attribute (playback speed override, custom trim, colour tag, etc.) belongs in `TrackEntry.extra` until formalised, then gets promoted to a named field in the next minor schema version. It never goes in the `tracks` SQLite table — that's library-level metadata shared across all playlists.

---

## Implementation Phases

### Phase 1 — Working playlists (prerequisite for everything else)
Priority: implement these before any branching or merge UI.

| Task | Backend | Frontend |
|---|---|---|
| Migration `0007`: add `artwork_hash` + `description` cache cols to `playlists` | new migration | — |
| Refactor `playlist_create` to write initial commit (no more NULL head) | update | — |
| `playlist_get_tracks` command (resolves meta + tracks from HEAD tree blob) | new | — |
| `playlist_remove_track` command | new | — |
| `playlist_reorder_tracks` command | new | — |
| `playlist_delete` command | new (DB fn exists) | — |
| `playlist_rename` command (commits new meta, updates SQL cache) | new | — |
| `playlist_set_artwork` command (writes artwork to CAS, commits new meta, updates SQL cache) | new | — |
| `playlist_get_artwork` command (reads from SQL cache `artwork_hash` → CAS) | new | — |
| Indexer updated to rebuild `name`/`artwork_hash`/`description` from HEAD tree blob on reconcile | update | — |
| Sidebar reads `playlist_get_all`, shows real playlists with artwork | — | sidebar wiring |
| "New Playlist" button + name modal | — | new component |
| Selecting a playlist loads its tracks via `playlist_get_tracks` | — | main view wiring |
| "Add to playlist" from Library bulk-action wired to `branch_append_tracks` | — | existing modal wiring |
| Playlist header shows artwork; click opens artwork editor | — | new component |
| Artwork editor: file picker + drag-and-drop + crop tool (reuse Editor pattern) | — | new component |

### Phase 2 — Branching UI
- Branch switcher dropdown in the playlist header (next to the playlist name).
- "New branch from here" button on any commit in the History tab.
- `branch_delete` and `branch_rename` commands + UI.
- `branch_revert_to` convenience command.

### Phase 3 — Merge UI
- "Merge branch" button in playlist header.
- Merge strategy picker (union / intersection).
- `branch_merge` Rust command.
- Show merge commits differently in the commit graph (two lines converging).

### Phase 4 — Sublists
- `playlist_add_include` / remove / pin / unpin commands.
- `playlist_get_tracks` recursive resolver.
- "Includes" section in Playlist Settings panel.
- Visual indicator in tracklist showing which tracks come from a sublist.

---

## Gap Summary

| Feature | DB schema | Rust command | Frontend |
|---|---|---|---|
| Read playlist tracks | ✅ (tree blob model) | ❌ missing | ❌ missing |
| Remove / reorder tracks | ✅ | ❌ missing | ❌ missing |
| Delete / rename playlist | ✅ (DB fns exist) | ❌ no Tauri command | ❌ missing |
| Add tracks from Library | ✅ | ✅ `branch_append_tracks` | ❌ not wired |
| Branching | ✅ | ✅ `branch_create` | ❌ no UI |
| Branch delete / rename | ✅ | ❌ missing | ❌ missing |
| Merge | ✅ (two-parent commits) | ❌ `branch_merge` missing | ❌ missing |
| Playlist artwork + name/desc in tree | ❌ needs v2 blob schema + migration 0007 | ❌ missing | ❌ missing |
| Sublists / includes | ❌ needs blob schema ext | ❌ all commands missing | ❌ missing |
| Revert to commit | ✅ | ❌ convenience cmd missing | ❌ missing |

*Last updated: 2026-05-07*
