import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { LoadStatus, TrackRecord } from './types'

export type LibrarySlice = {
  tracks: TrackRecord[]
  libraryStatus: LoadStatus

  loadLibrary: () => Promise<void>
  toggleFavorite: (hash: string) => void
  // Avoids a DB round-trip: makes synced tracks visible to the player before loadLibrary() completes.
  hydrateTracksFromPlaylist: (playlistTracks: TrackRecord[]) => void
}

export const createLibrarySlice: StateCreator<LibrarySlice> = (set, get) => ({
  tracks: [],
  libraryStatus: 'idle',

  loadLibrary: async () => {
    set({ libraryStatus: 'loading' })
    try {
      const tracks = await invoke<TrackRecord[]>('library_get_all')
      set({ tracks, libraryStatus: 'ready' })
    } catch {
      set({ libraryStatus: 'error' })
    }
  },

  hydrateTracksFromPlaylist: (playlistTracks) => {
    const current = get().tracks
    const existing = new Map(current.map(t => [t.hash, t]))
    let changed = false
    for (const pt of playlistTracks) {
      if (!existing.has(pt.hash)) {
        existing.set(pt.hash, pt)
        changed = true
      }
    }
    if (changed) set({ tracks: [...existing.values()] })
  },

  toggleFavorite: (hash) => {
    const track = get().tracks.find((t) => t.hash === hash)
    if (!track) return

    const favorited = !track.favorited

    // Optimistic update so the UI responds instantly
    set({ tracks: get().tracks.map((t) => t.hash === hash ? { ...t, favorited } : t) })

    invoke('library_set_favorite', { hash, favorited }).catch(() => {
      // Roll back if the backend rejects the write
      set({ tracks: get().tracks.map((t) => t.hash === hash ? { ...t, favorited: !favorited } : t) })
    })
  },
})
