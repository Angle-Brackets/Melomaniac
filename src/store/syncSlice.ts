import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { ConflictChunk, ConflictResolution } from './types'

export type SyncSlice = {
  mergeConflicts:  ConflictChunk[]
  mergePlaylistId: string | null
  currentChunkIdx: number

  resolutions: ConflictResolution[]

  diffViewerOpen: boolean

  openDiffViewer:   (playlistId: string, conflicts: ConflictChunk[]) => void
  closeDiffViewer:  () => void
  submitResolution: (resolution: ConflictResolution) => void
  finalizeMerge:    () => Promise<void>
}

export const createSyncSlice: StateCreator<SyncSlice> = (set, get) => ({
  mergeConflicts:  [],
  mergePlaylistId: null,
  currentChunkIdx: 0,
  resolutions:     [],
  diffViewerOpen:  false,

  openDiffViewer: (playlistId, conflicts) => set({
    mergePlaylistId: playlistId,
    mergeConflicts:  conflicts,
    currentChunkIdx: 0,
    resolutions:     [],
    diffViewerOpen:  true,
  }),

  closeDiffViewer: () => set({ diffViewerOpen: false }),

  submitResolution: (resolution) => set(state => ({
    resolutions:     [...state.resolutions, resolution],
    currentChunkIdx: state.currentChunkIdx + 1,
  })),

  finalizeMerge: async () => {
    const { mergePlaylistId, resolutions } = get()
    await invoke('resolve_merge_conflict', {
      playlistId: mergePlaylistId,
      resolutions,
    })
    set({
      mergeConflicts:  [],
      mergePlaylistId: null,
      currentChunkIdx: 0,
      resolutions:     [],
      diffViewerOpen:  false,
    })
  },
})
