import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { ConflictChunk, ConflictResolution, KnownDevice, QrPayload } from './types'

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

  // Pairing UI state
  pairingOpen:   boolean
  pairingMode:   'display' | 'scan' | null
  qrPayload:     QrPayload | null
  knownDevices:  KnownDevice[]
  fingerprint:   string

  // Pairing actions
  openPairingDisplay:  () => Promise<void>
  openPairingScanner:  () => void
  closePairing:        () => void
  submitScannedQr:     (payload: QrPayload) => Promise<void>
  refreshKnownDevices: () => Promise<void>
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

  // Pairing initial state
  pairingOpen:  false,
  pairingMode:  null,
  qrPayload:    null,
  knownDevices: [],
  fingerprint:  '',

  openPairingDisplay: async () => {
    const [payload, fp] = await Promise.all([
      invoke<QrPayload>('sync_generate_qr_payload'),
      invoke<string>('sync_get_fingerprint'),
    ])
    set({ qrPayload: payload, fingerprint: fp, pairingOpen: true, pairingMode: 'display' })
  },

  openPairingScanner: () => set({ pairingOpen: true, pairingMode: 'scan' }),

  closePairing: () => set({ pairingOpen: false, pairingMode: null, qrPayload: null }),

  submitScannedQr: async (payload) => {
    await invoke('sync_accept_qr_pairing', { payload })
    await get().refreshKnownDevices()
    get().closePairing()
  },

  refreshKnownDevices: async () => {
    const devices = await invoke<KnownDevice[]>('sync_known_devices')
    set({ knownDevices: devices })
  },
})
