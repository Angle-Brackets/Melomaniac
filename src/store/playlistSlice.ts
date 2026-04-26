import { StateCreator } from 'zustand'
import { LoadStatus, PlaylistMeta } from './types'

export type PlaylistSlice = {
  playlists: PlaylistMeta[]
  currentCommitHash: string | null // head commit of the active playlist
  playlistStatus: LoadStatus

  loadPlaylists: () => Promise<void>
  setCurrentPlaylist: (commitHash: string) => void
}

export const createPlaylistSlice: StateCreator<PlaylistSlice> = (set) => ({
  playlists: [],
  currentCommitHash: null,
  playlistStatus: 'idle',

  // No-op until the CAS/Commit layer is built — will walk the commit chain from SQLite
  loadPlaylists: async () => {
    set({ playlistStatus: 'ready' })
  },

  setCurrentPlaylist: (commitHash) => set({ currentCommitHash: commitHash }),
})
