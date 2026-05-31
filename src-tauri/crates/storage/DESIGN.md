# Storage Layer — Design Reference

Implementation reference for `melomaniac-storage`. Read this before touching anything
in `src-tauri/crates/storage/` or `src-tauri/src/storage.rs`.

---

## Responsibilities

| Component | Responsibility |
|---|---|
| `CasStore` | BLAKE3 hashing, blob read/write, deduplication |
| `Database` | SQLite connection pool, schema migrations, CRUD |
| `Indexer` | Startup reconciliation between CAS blobs and SQLite |

**Not in scope:** path resolution from Tauri's `app_data_dir()`. That happens in the
Tauri command layer (`src-tauri/src/storage.rs`) before any storage type is touched.
This crate takes plain `PathBuf` values and has zero Tauri dependency.

---

## Directory Layout (runtime)

```
<app_data_dir>/
  objects/
    ab/          ← first 2 hex chars of BLAKE3 hash
      cdef1234…  ← remaining 62 hex chars — raw blob (audio, artwork, tree, or commit JSON)
  db.sqlite
```

| Platform | `app_data_dir` |
|---|---|
| Linux   | `~/.local/share/melomaniac/` |
| macOS   | `~/Library/Application Support/com.melomaniac.app/` |
| Windows | `%APPDATA%\melomaniac\` |
| iOS     | `Library/Application Support/` |
| Android | internal files dir (`getFilesDir()`) |

Tests pass a `tempfile::TempDir` instead — the code path is identical.

---

## CAS (`cas.rs`)

BLAKE3 produces 32 bytes → 64 lowercase hex chars. This is the canonical identity for
every blob. Two files with identical bytes share one blob.

```rust
pub struct CasStore { objects_dir: PathBuf }

impl CasStore {
    pub fn new(objects_dir: PathBuf) -> Self
    pub fn hash(data: &[u8]) -> String           // pure — no I/O
    pub fn blob_path(&self, hash: &str) -> PathBuf
    pub fn exists(&self, hash: &str) -> bool
    pub async fn write_blob(&self, data: &[u8]) -> Result<String, StorageError>
    pub async fn read_blob(&self, hash: &str) -> Result<Vec<u8>, StorageError>
}
```

Write path: hash → check exists → create parent dir → write to `<path>.tmp` → rename
into place. Atomic rename prevents a half-written blob from being visible to readers.

---

## Database (`db.rs`)

sqlx `SqlitePool` with `WAL` journal mode and foreign keys enabled. Runtime-checked
queries (`query_as` function, not macro) so `DATABASE_URL` is not required during
development. Compile-time checking can be added later via `cargo sqlx prepare`.

### Schema

#### `tracks`
```sql
CREATE TABLE IF NOT EXISTS tracks (
    hash         TEXT    PRIMARY KEY,
    title        TEXT    NOT NULL,
    artist       TEXT    NOT NULL,
    album        TEXT,
    artwork_hash TEXT,
    duration_ms  INTEGER NOT NULL,
    favorited    INTEGER NOT NULL DEFAULT 0
);
```

#### `plays` / `skips` *(schema now, populated in P2)*
```sql
CREATE TABLE IF NOT EXISTS plays (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    hash      TEXT    NOT NULL REFERENCES tracks(hash) ON DELETE CASCADE,
    played_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    hash       TEXT    NOT NULL REFERENCES tracks(hash) ON DELETE CASCADE,
    skipped_at INTEGER NOT NULL
);
```

#### `playlists`
A playlist **is** a repository — stable UUID identity regardless of content changes.
```sql
CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL,
    forked_from TEXT    REFERENCES playlists(id)
);
```

#### `branches`
A branch is a subplaylist — named HEAD pointer within a playlist. Every new playlist
gets a `main` branch automatically.
```sql
CREATE TABLE IF NOT EXISTS branches (
    id          TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    head_commit TEXT,
    UNIQUE(playlist_id, name)
);
```

#### `commits`
Stored in SQLite for fast traversal; also written as a CAS blob for future sync
integrity verification.
```sql
CREATE TABLE IF NOT EXISTS commits (
    hash      TEXT PRIMARY KEY,
    tree_hash TEXT    NOT NULL,
    timestamp INTEGER NOT NULL,
    device_id TEXT    NOT NULL,
    message   TEXT
);
```

#### `commit_parents`
Separate table so merge commits (two parents from P2P CRDT sync) need no schema change.
Root commits have zero rows; normal commits one; merge commits two.
```sql
CREATE TABLE IF NOT EXISTS commit_parents (
    commit_hash TEXT NOT NULL REFERENCES commits(hash) ON DELETE CASCADE,
    parent_hash TEXT NOT NULL REFERENCES commits(hash) ON DELETE RESTRICT,
    PRIMARY KEY (commit_hash, parent_hash)
);
```

### Migrations

```
migrations/
  0001_create_tracks.sql
  0002_create_plays_skips.sql
  0003_create_playlists_branches.sql
  0004_create_commits.sql
```

Run at startup: `sqlx::migrate!("migrations/").run(&pool).await?`

### Rust record types

All types derive `sqlx::FromRow` and `serde::Serialize` — they serialise directly to
the frontend. TypeScript types in `src/store/types.ts` use matching snake_case fields.

```rust
pub struct TrackRecord    { hash, title, artist, album?, artwork_hash?, duration_ms: i64, favorited: bool }
pub struct PlaylistRecord { id, name, description?, created_at: i64, forked_from? }
pub struct BranchRecord   { id, playlist_id, name, head_commit? }
pub struct CommitRecord   { hash, tree_hash, timestamp: i64, device_id, message? }
```

---

## Indexer (`indexer.rs`)

Runs once at startup. Reconciliation only — does not auto-ingest new blobs because
metadata must come through the ingest path.

```
db_hashes  = SELECT hash FROM tracks
cas_hashes = walk objects_dir (skip .tmp files)

stale  = db_hashes − cas_hashes  → DELETE FROM tracks
orphan = cas_hashes − db_hashes  → eprintln! warning; leave alone
```

---

## Ingest Flow

Two equal first-class sources — neither is preferred:

| Source | Metadata origin |
|---|---|
| yt-dlp download | yt-dlp JSON output |
| Direct file import | Embedded tags via symphonia; fall back to filename |

Both converge at the same steps:
```
1. Obtain bytes + metadata
2. cas.write_blob(&audio_bytes)   → audio_hash
3. cas.write_blob(&artwork_bytes) → artwork_hash  (skip if none)
4. db.insert_track(&TrackRecord { hash: audio_hash, … })
5. Emit Tauri event → frontend library refresh
```

---

## Playlist / Repository

### Concept mapping

| Melomaniac | Git | Notes |
|---|---|---|
| Playlist   | Repository | Stable UUID; rename doesn't change identity |
| Subplaylist | Branch | Named HEAD pointer within a playlist |
| Fork       | Fork | New playlist copying source branch HEADs; history is shared, diverges independently |
| Commit     | Commit | Snapshot; points to a tree + parent(s) |
| Tree       | Tree | Ordered track list; JSON CAS blob |

### Tree blob format
```json
{ "tracks": [{ "hash": "<blake3>", "ab_start_ms": null, "ab_end_ms": null }] }
```
`ab_start_ms`/`ab_end_ms` are the P1 Smart Loop A/B timestamps. Both null = full track.

### Operations

**Create playlist:** INSERT playlist + INSERT main branch (head_commit = NULL)

**Create subplaylist:** INSERT branch with head_commit = source branch's current HEAD

**Commit to branch:**
```
tree_json → cas.write_blob → tree_hash
commit_json = { tree_hash, parents, timestamp, device_id, message }
commit_hash = BLAKE3(commit_json)
cas.write_blob(commit_json)          ← integrity + future sync
INSERT INTO commits …
INSERT INTO commit_parents …         ← skip for root commit
UPDATE branches SET head_commit = commit_hash
```

**Fork:** INSERT new playlist (forked_from = source_id) + copy all source branches
pointing to the same head_commit values. New commits diverge independently.

---

## Tauri Command Layer (`src-tauri/src/storage.rs`)

```rust
pub struct StorageState { pub cas: CasStore, pub db: Database }

// playlist_get_all returns this — branches are not on PlaylistRecord itself
pub struct PlaylistWithBranches { playlist: PlaylistRecord, branches: Vec<BranchRecord> }
```

| Command | Notes |
|---|---|
| `library_get_all` | Unblocks `librarySlice.loadLibrary()` |
| `library_set_favorite` | Unblocks `librarySlice.toggleFavorite()` |
| `playlist_get_all` | Returns `Vec<PlaylistWithBranches>` |
| `playlist_create` | Creates playlist + default `main` branch |
| `playlist_fork` | Forks all branches from source |
| `branch_create` | Creates a subplaylist from an existing HEAD |
| `branch_commit` | Builds tree, writes commit, advances HEAD |

Initialised in `lib.rs` via `tauri::async_runtime::block_on`.

---

## Platform Notes

SQLite and file I/O are POSIX-compatible on all targets. One Android-only flag needed:

```toml
[target.'cfg(target_os = "android")'.dependencies]
libsqlite3-sys = { version = "*", features = ["bundled"] }
```

iOS uses system SQLite and needs no extra config.

---

## Test Strategy

Each test gets an isolated `TempDir`; dropped on test end, never shared across tests.
Dev dependencies: `tempfile`, `tokio` (macros + rt-multi-thread).

---

## Decisions Locked In

| Decision | Rationale |
|---|---|
| Tauri-free crate | Independently testable; path resolution is the command layer's job |
| sqlx runtime queries (no macro) | Avoids `DATABASE_URL` / `cargo sqlx prepare` setup cost during initial development |
| WAL + foreign keys enabled | Better concurrent read performance; referential integrity enforced at the DB level |
| Atomic blob writes | Crash-safe; no partial blobs visible to readers |
| Indexer reconciles only | No silent data without provenance — metadata must enter via ingest |
| `plays`/`skips` defined now | Zero-cost schema definition now avoids a live migration later |
| Playlist = Repository | Git-model naming from day one — no rename when branches/forks are exposed in UI |
| `commit_parents` separate table | Supports merge commits without a schema change |
| Fork shares commit objects | History is content-addressed and immutable; only branch HEAD pointers are copied |
| yt-dlp and file import are equal | Both converge at `write_blob` + `insert_track`; neither is the "real" path |
