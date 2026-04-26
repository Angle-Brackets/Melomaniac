// String values (not numeric) so enums are human-readable in devtools and survive JSON round-trips
// without a lookup table. Vite's isolatedModules mode also rules out const enums across files.

export enum ShuffleMode {
  Off    = 'Off',
  Random = 'Random', // random picks each refill, history-deduped
  Smart  = 'Smart',  // pre-computed Fisher-Yates permutation; no repeats until the full cycle is exhausted
}

export enum RepeatMode {
  None = 'None',
  One  = 'One',
  All  = 'All',
}

// All fields use snake_case to match the Rust TrackRecord serde output directly.
// artwork_hash is a BLAKE3 hash of the artwork blob in CAS, not a URL or path.
export type TrackRecord = {
  hash:         string
  title:        string
  artist:       string
  album:        string | null
  artwork_hash: string | null
  duration_ms:  number
  favorited:    boolean
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

// Shared across library and playlist slices — avoids repeating the same union in each slice type
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
