import { useMemo } from 'react'
import { useStore } from './index'
import type { SpotifyRow } from './spotifySlice'

// The store's `activeSpotifyRows()` recomputes a fresh array on every call, so
// calling it directly inside a useStore selector defeats reference-equality
// checks and causes an infinite re-render loop (React "Maximum update depth
// exceeded"). Subscribe to the raw slices instead and memoize the derived rows.
export function useActiveSpotifyRows(source: string | null): SpotifyRow[] {
  const importedTracks = useStore(s => s.importedTracks)
  const reviewTracks   = useStore(s => s.reviewTracks)
  const tracks         = useStore(s => s.tracks)
  return useMemo(() => {
    if (!source) return []
    const tracksByHash = new Map(tracks.map(t => [t.hash, t]))
    return importedTracks
      .filter(r => r.source === source)
      .map((record): SpotifyRow => {
        const review = reviewTracks[record.spotify_id]
        if (review) return { kind: 'review', review, record }
        const local = record.matched_hash ? tracksByHash.get(record.matched_hash) : undefined
        return local
          ? { kind: 'local', track: local, spotifyId: record.spotify_id }
          : { kind: 'external', record }
      })
  }, [source, importedTracks, reviewTracks, tracks])
}
