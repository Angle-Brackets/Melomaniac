import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { LoadStatus, PlaylistRecord } from './types'

const BRANCH_MAP_KEY = 'mm_branch_by_playlist'

function loadBranchMap(): Record<string, string> {
  try {
    const s = localStorage.getItem(BRANCH_MAP_KEY)
    if (s) return JSON.parse(s)
  } catch {}
  // Migrate legacy single-value key if present
  const legacy = localStorage.getItem('mm_active_branch')
  if (legacy) return {}
  return {}
}

export type PlaylistSlice = {
  playlists:          PlaylistRecord[]
  currentPlaylistId:  string | null
  currentBranchName:  string
  branchByPlaylist:   Record<string, string>
  playlistStatus:     LoadStatus

  loadPlaylists: () => Promise<void>
  setCurrentPlaylist: (id: string) => void
  setCurrentBranch: (name: string) => void
}

export const createPlaylistSlice: StateCreator<PlaylistSlice> = (set) => ({
  playlists:         [],
  currentPlaylistId: null,
  currentBranchName: 'main',
  branchByPlaylist:  loadBranchMap(),
  playlistStatus:    'idle',

  loadPlaylists: async () => {
    set({ playlistStatus: 'loading' })
    try {
      const playlists = await invoke<PlaylistRecord[]>('playlist_get_all')
      set({ playlists, playlistStatus: 'ready' })
    } catch {
      set({ playlistStatus: 'error' })
    }
  },

  setCurrentPlaylist: (id) => set(state => ({
    currentPlaylistId: id,
    currentBranchName: state.branchByPlaylist[id] ?? 'main',
  })),

  setCurrentBranch: (name) => set(state => {
    const updated = { ...state.branchByPlaylist }
    if (state.currentPlaylistId) updated[state.currentPlaylistId] = name
    try { localStorage.setItem(BRANCH_MAP_KEY, JSON.stringify(updated)) } catch {}
    return { currentBranchName: name, branchByPlaylist: updated }
  }),
})
