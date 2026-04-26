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

export type TrackMeta = {
  hash: string
  title: string
  artist: string
  album: string | null
  artworkHash: string | null
  duration_ms: number
  favorited: boolean
}

export type PlaylistMeta = {
  commitHash: string
  name: string
  trackCount: number
}

// Shared across library and playlist slices — avoids repeating the same union in each slice type
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
