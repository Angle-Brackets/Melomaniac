import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { LoadStatus, PlaylistRecord } from './types'

export type PlaylistSlice = {
  playlists:          PlaylistRecord[]
  currentPlaylistId:  string | null
  currentBranchName:  string
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

  loadPlaylists: async () => {
    set({ playlistStatus: 'loading' })
    try {
      // playlist_get_all returns Vec<PlaylistWithBranches> which flattens to PlaylistRecord[]
      const playlists = await invoke<PlaylistRecord[]>('playlist_get_all')
      set({ playlists, playlistStatus: 'ready' })
    } catch {
      set({ playlistStatus: 'error' })
    }
  },

  setCurrentPlaylist: (id) => set({ currentPlaylistId: id, currentBranchName: 'main' }),

  setCurrentBranch: (name) => set({ currentBranchName: name }),
})
