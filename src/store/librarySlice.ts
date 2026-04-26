import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { LoadStatus, TrackRecord } from './types'

export type LibrarySlice = {
  tracks: TrackRecord[]
  libraryStatus: LoadStatus

  loadLibrary: () => Promise<void>
  toggleFavorite: (hash: string) => void
}

export const createLibrarySlice: StateCreator<LibrarySlice> = (set, get) => ({
  tracks: [],
  libraryStatus: 'idle',

  // No-op until the SQLite/CAS layer is built — Tauri command will be `library_get_all`
  loadLibrary: async () => {
    set({ libraryStatus: 'loading' })
    try {
      const tracks = await invoke<TrackRecord[]>('library_get_all')
      set({ tracks, libraryStatus: 'ready' })
    } catch {
      set({ libraryStatus: 'error' })
    }
  },

  toggleFavorite: (hash) => {
    const track = get().tracks.find((t) => t.hash === hash)
    if (!track) return

    const favorited = !track.favorited

    // Optimistic update so the UI responds instantly
    set({ tracks: get().tracks.map((t) => t.hash === hash ? { ...t, favorited } : t) })

    // No-op until the SQLite/CAS layer is built — Tauri command will be `library_set_favorite`
    invoke('library_set_favorite', { hash, favorited }).catch(() => {
      // Roll back if the backend rejects the write
      set({ tracks: get().tracks.map((t) => t.hash === hash ? { ...t, favorited: !favorited } : t) })
    })
  },
})
