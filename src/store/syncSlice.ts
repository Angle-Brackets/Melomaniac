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

  // Per-playlist download progress (0–1). Present while downloading, absent when idle.
  downloadProgress: Record<string, number>
  setDownloadProgress: (playlistId: string, pct: number) => void
  clearDownloadProgress: (playlistId: string) => void

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
  downloadPlaylist:  (playlistId: string, branchNames: string[]) => Promise<void>
}

// Tracks peers we've already auto-synced this session so we don't re-fire
// on every poll cycle. Cleared on app restart (module reload).
const autoSyncedPeers = new Set<string>()

export const createSyncSlice: StateCreator<StoreState, [], [], SyncSlice> = (set, get) => {
  const showToast = (msg: string) => {
    set({ syncToast: msg })
    setTimeout(() => set({ syncToast: null }), 3000)
  }

  const triggerAutoSync = (peer: PeerInfo) => {
    invoke<PlaylistManifest[]>('sync_fetch_peer_manifest', { publicKeyB64: peer.public_key_b64 })
      .then(async manifest => {
        const { playlists } = get()
        const localIds = new Set(playlists.map(p => p.id))
        const toSync = manifest.filter(m => localIds.has(m.id))
        if (toSync.length === 0) return

        let synced = 0
        for (const entry of toSync) {
          const localBranches = new Set(
            playlists.find(p => p.id === entry.id)?.branches.map(b => b.name) ?? []
          )
          const branchNames = (entry.branches?.map(b => b.name) ?? ['main'])
            .filter(name => localBranches.has(name))
          if (branchNames.length === 0) continue
          try {
            if (branchNames.length === 1) {
              await invoke('sync_playlist', { playlistId: entry.id, branchName: branchNames[0] })
            } else {
              await invoke('sync_playlist_branches', { playlistId: entry.id, branchNames })
            }
            synced++
          } catch { /* peer went offline mid-sync — skip */ }
        }

        if (synced > 0) {
          await Promise.all([get().loadPlaylists(), get().loadLibrary()])
          showToast(`Auto-synced ${synced} playlist${synced !== 1 ? 's' : ''} with ${peer.display_name}`)
        }
      })
      .catch(() => { /* peer unreachable — will retry next session */ })
  }

  return ({
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
    try {
      await invoke('resolve_merge_conflict', { playlistId: mergePlaylistId, resolutions })
      set({ mergeConflicts: [], mergePlaylistId: null, currentChunkIdx: 0, resolutions: [], diffViewerOpen: false })
      await Promise.all([get().loadPlaylists(), get().loadLibrary()])
      showToast('Merge resolved — playlist updated')
    } catch (e) {
      showToast(`Merge failed: ${String(e).slice(0, 60)}`)
    }
  },

  // Pairing initial state
  pairingOpen:       false,
  pairingMode:       null,
  qrPayload:         null,
  knownDevices:      [],
  fingerprint:       '',
  livePeers:         [],
  syncToast:         null,
  downloadProgress:  {},

  setDownloadProgress: (playlistId, pct) => set(state => ({
    downloadProgress: { ...state.downloadProgress, [playlistId]: pct },
  })),

  clearDownloadProgress: (playlistId) => set(state => {
    const next = { ...state.downloadProgress }
    delete next[playlistId]
    return { downloadProgress: next }
  }),

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
    showToast(`Paired with ${payload.display_name}`)
    get().closePairing()
  },

  refreshKnownDevices: async () => {
    const devices = await invoke<KnownDevice[]>('sync_known_devices')
    set({ knownDevices: devices })
  },

  refreshLivePeers: async () => {
    const peers = await invoke<PeerInfo[]>('sync_get_peers')
    set({ livePeers: peers })
    for (const peer of peers) {
      if (!autoSyncedPeers.has(peer.public_key_b64)) {
        autoSyncedPeers.add(peer.public_key_b64)
        triggerAutoSync(peer)
      }
    }
  },

  syncWithPeer: async (publicKeyB64) => {
    const peer = get().livePeers.find(p => p.public_key_b64 === publicKeyB64)
    const peerName = peer?.display_name ?? 'device'
    try {
      const report = await invoke<SyncReport>('sync_with_peer', { publicKeyB64 })
      if (report.conflicts.length > 0) {
        showToast(`Synced with ${peerName} — ${report.conflicts.length} conflict(s) to resolve`)
      } else {
        const items = report.blobs_fetched
        showToast(items > 0
          ? `Synced with ${peerName} — ${items} item${items !== 1 ? 's' : ''} updated`
          : `Up to date with ${peerName}`
        )
      }
    } catch {
      showToast(`Sync with ${peerName} failed`)
    }
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
      set({ peerManifestOpen: false, peerManifestLoading: false })
      showToast(`Could not reach ${peer.display_name}`)
    }
  },

  closePeerManifest: () => set({
    peerManifestOpen: false,
    peerManifestPeer: null,
    peerManifest: null,
    peerManifestLoading: false,
  }),

  downloadPlaylist: async (playlistId, branchNames) => {
    set(state => ({ downloadingPlaylists: [...state.downloadingPlaylists, playlistId] }))
    try {
      const report = branchNames.length === 1
        ? await invoke<SyncReport>('sync_playlist', { playlistId, branchName: branchNames[0] })
        : await invoke<SyncReport>('sync_playlist_branches', { playlistId, branchNames })
      set(state => ({
        downloadingPlaylists: state.downloadingPlaylists.filter(id => id !== playlistId),
        downloadProgress: (() => { const n = { ...state.downloadProgress }; delete n[playlistId]; return n })(),
      }))
      await Promise.all([get().loadPlaylists(), get().loadLibrary()])

      if (report.conflicts.length > 0) {
        get().openDiffViewer(playlistId, report.conflicts)
        showToast(`${report.conflicts.length} conflict${report.conflicts.length !== 1 ? 's' : ''} need resolution`)
      } else {
        const items = report.blobs_fetched
        showToast(items > 0
          ? `Synced — ${items} item${items !== 1 ? 's' : ''} downloaded`
          : 'Already up to date'
        )
      }
    } catch (e) {
      set(state => {
        const dp = { ...state.downloadProgress }
        delete dp[playlistId]
        return {
          downloadingPlaylists: state.downloadingPlaylists.filter(id => id !== playlistId),
          downloadProgress: dp,
        }
      })
      showToast(`Sync failed: ${String(e).slice(0, 60)}`)
    }
  },
})}

