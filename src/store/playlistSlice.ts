import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { LoadStatus, PlaylistRecord } from './types'

const BRANCH_MAP_KEY = 'mm_branch_by_playlist'

function loadBranchMap(): Record<string, string> {
  try {
    const s = localStorage.getItem(BRANCH_MAP_KEY)
    if (s) return JSON.parse(s)
    // Migrate legacy single-value key — inside try so this is safe in non-browser envs
    if (localStorage.getItem('mm_active_branch')) return {}
  } catch {}
  return {}
}

export type PlaylistSlice = {
  playlists:          PlaylistRecord[]
  currentPlaylistId:  string | null
  currentBranchName:  string   // browsing branch — what's selected in PlaylistDetail
  playingBranchName:  string   // playing branch — only updated when play is triggered
  branchByPlaylist:   Record<string, string>
  playlistStatus:     LoadStatus

  loadPlaylists: () => Promise<void>
  setCurrentPlaylist: (id: string) => void
  setCurrentBranch: (name: string) => void
  setPlayingBranch: (name: string) => void
}

export const createPlaylistSlice: StateCreator<PlaylistSlice> = (set) => ({
  playlists:         [],
  currentPlaylistId: null,
  currentBranchName: 'main',
  playingBranchName: 'main',
  branchByPlaylist:  loadBranchMap(),
  playlistStatus:    LoadStatus.Idle,

  loadPlaylists: async () => {
    set({ playlistStatus: LoadStatus.Loading })
    try {
      const playlists = await invoke<PlaylistRecord[]>('playlist_get_all')
      set({ playlists, playlistStatus: LoadStatus.Ready })
    } catch {
      set({ playlistStatus: LoadStatus.Error })
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

  setPlayingBranch: (name) => set({ playingBranchName: name }),
})
