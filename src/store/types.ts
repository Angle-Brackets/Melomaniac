// String values (not numeric) so enums are human-readable in devtools and survive JSON round-trips
// without a lookup table. Vite's isolatedModules mode also rules out const enums across files.

export enum ShuffleMode {
  Off    = 'Off',
  Random = 'Random', // Fisher-Yates permutation over the candidate pool; no repeats until the cycle exhausts
  Smart  = 'Smart',  // weighted selection that penalises same-artist back-to-back picks
}

export enum RepeatMode {
  None = 'None',
  One  = 'One',
  All  = 'All',
}

// All fields use snake_case to match the Rust TrackRecord serde output directly.
// artwork_hash is a BLAKE3 hash of the artwork blob in CAS, not a URL or path.
// mime_type is the IANA media type (e.g. "audio/mpeg") needed by iOS/Android because
// CAS blob paths have no file extension. Null for pre-migration rows.
export type TrackRecord = {
  hash:         string
  title:        string
  artist:       string
  album:        string | null
  artwork_hash: string | null
  duration_ms:  number
  favorited:    boolean
  mime_type:    string | null
  ingested_at:  number
  source_url:   string | null
}

// BranchRecord mirrors the Rust BranchRecord. head_commit is null for an empty branch.
export type BranchRecord = {
  id:          string
  playlist_id: string
  name:        string
  head_commit: string | null
}

// PlaylistRecord is a repository. branches are always eager-loaded alongside it.
// forked_from is the UUID of the source playlist, null if this is an original.
export type PlaylistRecord = {
  id:          string
  name:        string
  description: string | null
  created_at:  number
  forked_from: string | null
  branches:    BranchRecord[]
}

// PlaylistTrackRecord is TrackRecord + A/B loop points from the manifest
// (Rust: #[serde(flatten)] on the inner TrackRecord)
export type PlaylistTrackRecord = TrackRecord & {
  ab_start_ms: number | null
  ab_end_ms:   number | null
}

export type CommitRecord = {
  hash:      string
  tree_hash: string
  timestamp: number   // Unix seconds (i64 in Rust)
  device_id: string
  message:   string | null
}

// Shared across library and playlist slices — avoids repeating the same union in each slice type
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// ── Sync types ────────────────────────────────────────────────────────────────

export type ConflictKind =
  | 'TrackOrder'
  | 'TrackDeletedVsModified'
  | 'MetadataEdit'
  | 'BranchNameCollision'
  | 'AbLoopPoints'

export type ConflictChunk = {
  id:      string
  kind:    ConflictKind
  ours:    unknown   // shape depends on kind — see design doc
  theirs:  unknown
  context: unknown
}

export type SyncReport = {
  blobs_fetched: number
  bytes_fetched:  number
  conflicts:      ConflictChunk[]
}

export type KnownDevice = {
  public_key_b64: string
  display_name:   string
  added_at:       number
}

export type PeerInfo = {
  public_key_b64: string
  display_name:   string
  addr:           string
  latency_ms:     number | null
}

export type ConflictResolution = {
  conflict_id: string
  choice: 'KeepOurs' | 'KeepTheirs' | 'KeepBoth' | 'Delete'
  // For BranchNameCollision with rename:
  rename_to?: string
}

export type QrPayload = {
  public_key_b64: string
  display_name:   string
  addr:           string | null
  token:          string
  exp:            number  // Unix timestamp seconds
}

export type BranchInfo = {
  name:         string
  track_count:  number
  size_bytes:   number
  track_hashes: string[]
  head_commit:  string | null
}

export type PlaylistManifest = {
  id:           string
  name:         string
  description:  string | null
  branch_count: number
  track_count:  number
  size_bytes:   number
  artwork_hash: string | null
  head_commit:  string
  branches:     BranchInfo[]
}
