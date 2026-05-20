import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { ConflictChunk, ConflictResolution, KnownDevice, PeerInfo, PlaylistManifest, QrPayload, SyncReport } from './types'
import type { StoreState } from './index'

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

  // Live peers (discovered on LAN)
  livePeers: PeerInfo[]

  // Sync toast message
  syncToast: string | null

  // Peer playlist browser state
  peerManifestOpen:     boolean
  peerManifestPeer:     PeerInfo | null
  peerManifest:         PlaylistManifest[] | null
  peerManifestLoading:  boolean
  downloadingPlaylists: string[]

  // Pairing actions
  openPairingDisplay:  () => Promise<void>
  openPairingScanner:  () => void
  closePairing:        () => void
  submitScannedQr:     (payload: QrPayload) => Promise<void>
  refreshKnownDevices: () => Promise<void>
  refreshLivePeers:    () => Promise<void>
  syncWithPeer:        (publicKeyB64: string) => Promise<void>
  dismissSyncToast:    () => void

  // Peer manifest actions
  openPeerManifest:  (peer: PeerInfo) => Promise<void>
  closePeerManifest: () => void
  downloadPlaylist:  (playlistId: string) => Promise<void>
}

export const createSyncSlice: StateCreator<StoreState, [], [], SyncSlice> = (set, get) => ({
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
  livePeers:    [],
  syncToast:    null,

  // Peer manifest initial state
  peerManifestOpen:     false,
  peerManifestPeer:     null,
  peerManifest:         null,
  peerManifestLoading:  false,
  downloadingPlaylists: [],

  openPairingDisplay: async () => {
    const [payload, fp, peers] = await Promise.all([
      invoke<QrPayload>('sync_generate_qr_payload'),
      invoke<string>('sync_get_fingerprint'),
      invoke<PeerInfo[]>('sync_get_peers'),
    ])
    set({ qrPayload: payload, fingerprint: fp, pairingOpen: true, pairingMode: 'display', livePeers: peers })
  },

  openPairingScanner: () => set({ pairingOpen: true, pairingMode: 'scan' }),

  closePairing: () => set({ pairingOpen: false, pairingMode: null, qrPayload: null }),

  submitScannedQr: async (payload) => {
    await invoke('sync_accept_qr_pairing', { payload })
    await get().refreshKnownDevices()
    set({ syncToast: `Paired with ${payload.display_name}` })
    setTimeout(() => set({ syncToast: null }), 3000)
    get().closePairing()
  },

  refreshKnownDevices: async () => {
    const devices = await invoke<KnownDevice[]>('sync_known_devices')
    set({ knownDevices: devices })
  },

  refreshLivePeers: async () => {
    const peers = await invoke<PeerInfo[]>('sync_get_peers')
    set({ livePeers: peers })
  },

  syncWithPeer: async (publicKeyB64) => {
    const peer = get().livePeers.find(p => p.public_key_b64 === publicKeyB64)
    const peerName = peer?.display_name ?? 'device'
    try {
      const report = await invoke<SyncReport>('sync_with_peer', { publicKeyB64 })
      if (report.conflicts.length > 0) {
        set({ syncToast: `Synced with ${peerName} — ${report.conflicts.length} conflict(s) to resolve` })
      } else {
        const items = report.blobs_fetched
        set({ syncToast: items > 0
          ? `Synced with ${peerName} — ${items} item${items !== 1 ? 's' : ''} updated`
          : `Up to date with ${peerName}`
        })
      }
    } catch (e) {
      set({ syncToast: `Sync with ${peerName} failed` })
    }
    setTimeout(() => set({ syncToast: null }), 3000)
  },

  dismissSyncToast: () => set({ syncToast: null }),

  openPeerManifest: async (peer) => {
    set({
      peerManifestOpen: true,
      peerManifestPeer: peer,
      peerManifestLoading: true,
      peerManifest: null,
    })
    try {
      const result = await invoke<PlaylistManifest[]>('sync_fetch_peer_manifest', {
        publicKeyB64: peer.public_key_b64,
      })
      set({ peerManifest: result, peerManifestLoading: false })
    } catch {
      set({ peerManifestLoading: false, syncToast: `Could not reach ${peer.display_name}` })
      setTimeout(() => set({ syncToast: null }), 3000)
    }
  },

  closePeerManifest: () => set({
    peerManifestOpen: false,
    peerManifestPeer: null,
    peerManifest: null,
    peerManifestLoading: false,
  }),

  downloadPlaylist: async (playlistId) => {
    set(state => ({ downloadingPlaylists: [...state.downloadingPlaylists, playlistId] }))
    try {
      const report = await invoke<SyncReport>('sync_playlist', { playlistId })
      set(state => ({ downloadingPlaylists: state.downloadingPlaylists.filter(id => id !== playlistId) }))
      await get().loadPlaylists()
      const items = report.blobs_fetched
      set({ syncToast: items > 0
        ? `Downloaded playlist — ${items} item${items !== 1 ? 's' : ''} synced`
        : 'Playlist already up to date'
      })
    } catch {
      set(state => ({
        downloadingPlaylists: state.downloadingPlaylists.filter(id => id !== playlistId),
        syncToast: 'Download failed',
      }))
    }
    setTimeout(() => set({ syncToast: null }), 3000)
  },
})
