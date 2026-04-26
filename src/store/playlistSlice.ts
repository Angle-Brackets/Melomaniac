import { StateCreator } from 'zustand'
import { LoadStatus, PlaylistRecord } from './types'

export type PlaylistSlice = {
  playlists:          PlaylistRecord[]
  currentPlaylistId:  string | null   // UUID of the active playlist
  currentBranchName:  string          // active branch within that playlist; default "main"
  playlistStatus:     LoadStatus

  loadPlaylists: () => Promise<void>
  setCurrentPlaylist: (id: string) => void
  setCurrentBranch: (name: string) => void
}

export const createPlaylistSlice: StateCreator<PlaylistSlice> = (set) => ({
  playlists:         [],
  currentPlaylistId: null,
  currentBranchName: 'main',
  playlistStatus:    'idle',

  // No-op until the CAS/Commit layer is built — Tauri command will be `playlist_get_all`
  // Returns Vec<PlaylistRecord> with branches eager-loaded
  loadPlaylists: async () => {
    set({ playlistStatus: 'ready' })
  },

  setCurrentPlaylist: (id) => set({ currentPlaylistId: id, currentBranchName: 'main' }),

  // Switching branch does not reset the playlist — both are independent selections
  setCurrentBranch: (name) => set({ currentBranchName: name }),
})
