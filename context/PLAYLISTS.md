# Melomaniac — Playlist System Design

> Scope: what the backend supports today, gap analysis for requested features, and the implementation plan.

---

## Current Backend Model

### Data model (as-built)

```
playlists            branches               commits           commit_parents
──────────           ──────────             ───────           ──────────────
id (PK)              id (PK)                hash (PK)         commit_hash → commits
name                 playlist_id → playlists tree_hash        parent_hash → commits
description          name                   timestamp
created_at           head_commit → commits  device_id
forked_from → self   UNIQUE(playlist_id,name) message
forked_at_commit → commits  (merge-base for fork-back)
artwork_hash (cache)
```

Each **branch HEAD** points at a **commit**. Each **commit** points at a **tree blob** stored in CAS. A tree blob is a JSON document:

```json
{
  "tracks": [
    { "hash": "<blake3>", "ab_start_ms": null, "ab_end_ms": null }
  ]
}
```

`commit_parents` is a multi-row join: root commits have 0 rows, normal commits have 1, and merge commits have 2.

### Tauri commands (as-built)

| Command | What it does |
|---|---|
| `playlist_get_all` | All playlists + their branches |
| `playlist_create` | New playlist with a `main` branch and initial commit |
| `playlist_fork` | Copy playlist + all its branches (shared history); records `forked_from` + `forked_at_commit` |
| `playlist_get_tracks` | Resolve HEAD commit → tree blob → `TrackRecord[]` for a given branch |
| `playlist_remove_track` | Remove a hash from the current tree and commit |
| `playlist_reorder_tracks` | Rewrite track order in the tree and commit |
| `playlist_delete` | Delete a playlist and all its branches |
| `playlist_rename` | Rename a playlist (DB update) |
| `playlist_set_artwork` | Write image bytes to CAS, update `playlists.artwork_hash` |
| `playlist_get_artwork` | Read artwork bytes via `artwork_hash` → CAS |
| `playlist_get_graph` | Return all commits + parent edges for the commit graph UI |
| `branch_create` | New branch from optional commit |
| `branch_commit` | Write tree JSON → CAS, advance HEAD |
| `branch_append_tracks` | Load current tree, add hashes, commit |
| `branch_get_history` | First-parent walk from HEAD |
| `branch_delete` | Delete a branch by name |
| `branch_rename` | Rename a branch |
| `branch_revert_to` | Revert HEAD to a past commit (non-destructive, new commit) |
| `branch_merge` | Merge source branch into target with union/intersection strategy |
| `get_recent_commits` | Most recent commits across all branches |
| `library_get_stray_tracks` | Hashes not referenced in any active tree |

---

## Branch vs Fork vs Clone

These three concepts create "variations" of a playlist but with fundamentally different relationships:

| | Branch | Fork | Clone |
|---|---|---|---|
| Creates new playlist in sidebar? | No | Yes | Yes |
| Shares playlist identity? | Yes | No | No |
| Connected to source after creation? | Yes (same playlist) | No (independent) | Yes (live sync) |
| Can merge back to source? | Yes (same repo) | Yes (via PR-style merge, future) | No (pull-only) |
| Source pointer | — | `forked_from` + `forked_at_commit` | `cloned_from_url` |
| When to use | Experiment within same playlist | Start a new independent playlist from an existing one | Subscribe to someone else's playlist with updates |
| Phase | ✅ Done | ✅ Done | ⏳ P4 (requires sync server) |

### Branch
A divergent timeline *within* the same playlist. The branch dropdown in the playlist header switches between them. You're still working on "Chill Vibes" — just trying something. Branches share a playlist ID and can be compared, reverted, or merged.

### Fork
Creates a brand new, independent playlist seeded from the current state of another. It gets its own playlist ID and appears as a separate entry in the sidebar. After forking the two playlists have no live connection, but the origin is remembered so a future merge-back is possible.

**Schema:** `playlists.forked_from` (source playlist ID) + `playlists.forked_at_commit` (HEAD of `main` on the source at fork time). The `forked_at_commit` is the merge-base needed for three-way merge when merging a fork back upstream. Added in migration `0008`.

### Clone (future — requires sync server)
Downloads a remote playlist and keeps a live sync relationship with it. The clone knows its upstream URL and can pull new commits from it. Unlike a fork, the intent is to *follow* the source, not diverge from it. Source stored as `cloned_from_url` (URL, not a local playlist ID).

---

## Feature: Branching ✅

All backend and frontend work is complete.

- `branch_create`, `branch_delete`, `branch_rename`, `branch_revert_to` — all implemented and registered.
- Branch switcher in the playlist header.
- "New branch" and revert-to-commit actions in the History tab.

---

## Feature: Merging ✅

All backend and frontend work is complete.

- `branch_merge` implemented with `union` and `intersection` strategies.
- `MergeBranchModal` component wires the UI to the command.
- CommitGraph renders two-parent merge commits as diamonds, with source lane color preserved up to the merge point.

### What merging means for a playlist
Branches diverge after a fork or a `branch_create`. A merge produces a new commit whose tree is the result of the chosen strategy, with a two-parent commit record.

**Merge strategy — union (default):**
- Start with the target branch's track list (preserves order).
- Append any tracks from the source branch that aren't already in the target.

**Merge strategy — intersection:**
- Only keep tracks that appear in both branches.

`branch_merge` algorithm (union):
1. Resolve target HEAD → track hash list T.
2. Resolve source HEAD → track hash list S.
3. Merged list = T + (S − T) in order.
4. Write merged tree blob → CAS.
5. Write merge commit with parents = [target HEAD, source HEAD].
6. Advance target branch HEAD.

---

## Feature: Sublists (Playlist Includes)

This is the "submodule" analogy: playlist A embeds a reference to playlist B, so A's resolved track list includes B's tracks. When B is updated, A can either stay pinned to an old snapshot or auto-track B's branch HEAD.

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

- `pinned_commit: null` → tracks branch HEAD at read time.
- `pinned_commit: "<hash>"` → frozen snapshot.
- Old tree blobs without `includes` are unaffected.

### Circular reference protection
Pass a `visited: HashSet<(playlist_id, branch)>` set when resolving. Skip any sublist already in the set.

### What needs to be built
1. `playlist_add_include` command.
2. `playlist_remove_include` command.
3. `playlist_pin_include` command.
4. `playlist_get_tracks` recursive resolver (currently flat only).

---

## Feature: Revert to Past Commit ✅

Implemented as `branch_revert_to(playlist_id, branch_name, target_commit_hash)`. Loads the target commit's tree blob and writes it as a new commit (non-destructive; parent chain is preserved).

---

## Commit Strategy

### Auto-commit (silent, immediate, no user interaction)

| Operation | Generated message |
|---|---|
| Reorder tracks | `"Reorder: moved '{title}' to position {n}"` |
| Set A/B loop points | `"Set A/B: {title}"` |

### Acknowledged (staged, requires user confirmation before committing)

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

Rather than a blocking modal per action, acknowledged operations accumulate in a **per-playlist staging area** — a lightweight list of pending changes that lives in React state.

**UX model:**
- An acknowledged action executes optimistically in the UI (track appears/disappears immediately).
- A **commit bar** slides up at the bottom of the affected playlist view.
- Multiple acknowledged actions before committing are **batched into one commit**.
- "Discard all" rolls back the optimistic UI changes and clears the staging area.

---

## Sync Model: What Must Live in the Commit Graph

### The problem with SQL-only metadata

If `name`, `description`, and `artwork_hash` only live in the `playlists` SQLite table, they are device-local. When two devices sync their commit chains, the CAS graph transfers perfectly — but there's no mechanism to transfer the playlist name or artwork.

### The fix: meta section in the tree blob

Everything that must be consistent across devices belongs in the tree blob. Add a `meta` object alongside `tracks` and `includes`:

```
name, description, artwork_hash  →  tree blob meta section  (authoritative)
playlists SQL table columns       →  materialized cache       (fast queries)
```

The SQL columns still exist as a read cache rebuilt by the indexer from the latest commit's tree blob.

### Consequences

**Rename and set artwork are always commits.** A rename that doesn't commit never reaches another device.

**`playlist_create` writes the first commit.** New playlists start with an initial commit whose tree blob contains `meta.name` and empty `tracks: []`. The current pattern already does this.

**Remote push/pull works without any extra protocol.** Pull reachable CAS blobs, fast-forward or merge local branch. The indexer then rebuilds `name`/`artwork_hash` from the new HEAD.

### Conflict resolution for meta fields

If two devices both rename a playlist before syncing, the branches have diverged and a merge is needed. The merge strategy for `meta` fields is **last-commit-wins** — the merge commit takes `meta` from the branch with the later timestamp.

---

## Schema Evolution & Backwards Compatibility

### The core risk

Tree blobs are immutable CAS objects — once written, they never change. The risk is in **round-tripping**: a client that reads an old blob and writes a new one (e.g. after a reorder) must not silently strip fields it doesn't recognise.

### Rules

1. **Never rename or remove a field.** Only add new optional fields.
2. **All new fields must be optional with a sensible default.** `ab_start_ms: null`, `includes: []`, etc.
3. **Version the schema explicitly** — a top-level `"v"` integer. Start at `1`. Bump only for genuinely breaking changes.
4. **Unknown field passthrough** — capture unrecognised fields on deserialise and re-emit on serialise.

### Rust implementation pattern

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

    #[serde(default)]
    meta: PlaylistMeta,

    tracks: Vec<TrackEntry>,

    #[serde(default)]
    includes: Vec<IncludeEntry>,

    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}
```

### Version boundary summary

| v | Changes | Migration needed? |
|---|---|---|
| 1 | Initial: `tracks[]` with `hash`, `ab_start_ms`, `ab_end_ms` | — |
| 2 | Add `meta` (name, description, artwork_hash) + `includes[]` | No — absent fields → defaults |
| future | Any additive field | No — same pattern |
| breaking | Rename/remove/type-change a field | Yes — bump v, write migration fn |

---

## Implementation Phases

### Phase 1 — Working playlists ✅ Complete

| Task | Backend | Frontend |
|---|---|---|
| Migration `0007`: `artwork_hash` + `description` cols on `playlists` | ✅ | — |
| Migration `0008`: `forked_at_commit` on `playlists` | ✅ | — |
| `playlist_get_tracks` command | ✅ | ✅ wired in DesktopApp |
| `playlist_remove_track` command | ✅ | ✅ TrackList context menu |
| `playlist_reorder_tracks` command | ✅ | ✅ drag-and-drop |
| `playlist_delete` command | ✅ | ✅ PlaylistSettingsPanel |
| `playlist_rename` command | ✅ | ✅ PlaylistSettingsPanel |
| `playlist_set_artwork` / `playlist_get_artwork` commands | ✅ | ✅ PlaylistHeader |
| Sidebar reads `playlist_get_all`, shows real playlists | — | ✅ |
| "New Playlist" button + name modal | — | ✅ |
| "Add to playlist" from Library wired to `branch_append_tracks` | — | ✅ AddToPlaylistModal |
| Carousel + playback queue wired to active playlist tracks | — | ✅ `playlistTracks ?? trackOrder` |

### Phase 2 — Branching UI ✅ Complete

| Task | Backend | Frontend |
|---|---|---|
| `branch_delete` command | ✅ | ✅ PlaylistSettingsPanel |
| `branch_rename` command | ✅ | ✅ PlaylistSettingsPanel |
| `branch_revert_to` command | ✅ | ✅ History tab context menu |
| Branch switcher dropdown in playlist header | — | ✅ PlaylistHeader |
| "New branch from here" in History tab | — | ✅ |
| `playlist_get_graph` for commit graph UI | ✅ | ✅ CommitGraph |

### Phase 3 — Merge UI ✅ Complete

| Task | Backend | Frontend |
|---|---|---|
| `branch_merge` command (union + intersection strategies) | ✅ | — |
| Unit tests for `branch_append_tracks` + `branch_merge` | ✅ 11 tests | — |
| "Merge branch" modal with strategy picker | — | ✅ MergeBranchModal |
| CommitGraph: merge commits rendered as diamonds | — | ✅ |
| CommitGraph: source branch color preserved to merge point | — | ✅ |
| `playlist_fork` command + ForkPlaylistModal | ✅ | ✅ |

### Phase 4 — Sublists (future)

- `playlist_add_include` / remove / pin / unpin commands.
- `playlist_get_tracks` recursive resolver with cycle guard.
- "Includes" section in Playlist Settings panel.
- Visual indicator in tracklist showing which tracks come from a sublist.

### Phase 5 — Sync (future, requires backend server)

- `cloned_from_url` field on `playlists`.
- CAS push/pull over HTTP.
- Indexer reconcile pass on pull.
- Conflict resolution for diverged branches.

---

## Gap Summary

| Feature | DB schema | Rust command | Frontend |
|---|---|---|---|
| Read playlist tracks | ✅ | ✅ `playlist_get_tracks` | ✅ wired |
| Remove / reorder tracks | ✅ | ✅ | ✅ |
| Delete / rename playlist | ✅ | ✅ | ✅ |
| Add tracks from Library | ✅ | ✅ `branch_append_tracks` | ✅ |
| Branching | ✅ | ✅ | ✅ |
| Branch delete / rename | ✅ | ✅ | ✅ |
| Merge | ✅ (two-parent commits) | ✅ `branch_merge` | ✅ MergeBranchModal |
| Fork playlist | ✅ (`forked_from` + `forked_at_commit`) | ✅ `playlist_fork` | ✅ ForkPlaylistModal |
| Revert to commit | ✅ | ✅ `branch_revert_to` | ✅ |
| Commit graph UI | ✅ `playlist_get_graph` | ✅ | ✅ CommitGraph |
| Playlist artwork | ✅ migration 0007 | ✅ set/get commands | ✅ PlaylistHeader |
| Playlist name in tree blob (sync-safe) | ❌ still SQL-only | ❌ not committed to CAS | ❌ |
| Sublists / includes | ❌ needs blob schema ext | ❌ all commands missing | ❌ |
| Clone / sync | ❌ no `cloned_from_url` | ❌ no sync commands | ❌ |

*Last updated: 2026-05-08*
