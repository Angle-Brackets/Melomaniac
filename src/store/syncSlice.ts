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
  // Playlists that have unresolved merge conflicts stored in Rust's pending_merges.
  // Persists through closeDiffViewer so a badge remains until the user finalizes.
  pendingConflictPlaylists: string[]

  openDiffViewer:    (playlistId: string, conflicts: ConflictChunk[]) => void
  closeDiffViewer:   () => void
  submitResolution:  (resolution: ConflictResolution) => void
  finalizeMerge:     () => Promise<void>
  reopenConflict:    (playlistId: string) => Promise<void>

  pairingOpen:   boolean
  pairingMode:   'display' | 'scan' | null
  qrPayload:     QrPayload | null
  knownDevices:  KnownDevice[]
  fingerprint:   string

  livePeers: PeerInfo[]
  syncToast: string | null

  // Incremented whenever sync downloads new artwork blobs. Components that
  // cache artwork data URLs watch this to know when to bust their cache.
  artworkVersion: number
  bumpArtworkVersion: () => void

  // Incremented after every successful auto-sync (commits imported from a peer).
  // Desktop's CommitGraph watches this to know when to re-fetch history.
  syncVersion: number

  // Per-playlist download progress (0–1). Present while downloading, absent when idle.
  downloadProgress: Record<string, number>
  setDownloadProgress: (playlistId: string, pct: number) => void
  clearDownloadProgress: (playlistId: string) => void

  peerManifestOpen:     boolean
  peerManifestPeer:     PeerInfo | null
  peerManifest:         PlaylistManifest[] | null
  peerManifestLoading:  boolean
  downloadingPlaylists: string[]

  openPairingDisplay:  () => Promise<void>
  openPairingScanner:  () => void
  closePairing:        () => void
  submitScannedQr:     (payload: QrPayload) => Promise<void>
  refreshKnownDevices: () => Promise<void>
  refreshLivePeers:    () => Promise<void>
  syncWithPeer:        (publicKeyB64: string) => Promise<void>
  dismissSyncToast:    () => void

  openPeerManifest:  (peer: PeerInfo) => Promise<void>
  closePeerManifest: () => void
  downloadPlaylist:  (playlistId: string, branchNames: string[]) => Promise<void>
}

// Per-peer, per-branch last-known HEAD commit: Map<peerPk, Map<"id:branch", headCommit>>
// Cleared on app restart (module-level). Acts as the cheap checksum for diffs.
const lastSeenHeads = new Map<string, Map<string, string>>()
// Guards against concurrent auto-syncs for the same peer.
const syncingPeers = new Set<string>()

export const createSyncSlice: StateCreator<StoreState, [], [], SyncSlice> = (set, get) => {
  const showToast = (msg: string) => {
    set({ syncToast: msg })
    setTimeout(() => set({ syncToast: null }), 3000)
  }

  const triggerAutoSync = (peer: PeerInfo) => {
    if (syncingPeers.has(peer.public_key_b64)) return
    syncingPeers.add(peer.public_key_b64)

    invoke<PlaylistManifest[]>('sync_fetch_peer_manifest', { publicKeyB64: peer.public_key_b64 })
      .then(async manifest => {
        const { playlists } = get()

        // Guard: if the local store hasn't loaded yet, skip this poll entirely.
        // Do NOT update lastSeenHeads — if we do, the next poll will think
        // nothing changed even though we never actually compared against local state.
        if (playlists.length === 0) return

        const localIds = new Set(playlists.map(p => p.id))
        const peerLastSeen = lastSeenHeads.get(peer.public_key_b64) ?? new Map<string, string>()

        // Update stored HEADs for all branches we received before deciding what to sync,
        // so the next poll always has fresh data even if we skip syncing.
        const newLastSeen = new Map(peerLastSeen)
        for (const entry of manifest) {
          for (const b of entry.branches) {
            if (b.head_commit) newLastSeen.set(`${entry.id}:${b.name}`, b.head_commit)
          }
        }
        lastSeenHeads.set(peer.public_key_b64, newLastSeen)

        // Find playlists that exist locally and have at least one changed branch.
        const toSync: Array<{ id: string; branchNames: string[] }> = []
        for (const entry of manifest) {
          if (!localIds.has(entry.id)) continue
          const localBranches = new Set(
            playlists.find(p => p.id === entry.id)?.branches.map(b => b.name) ?? []
          )
          const changedBranches = entry.branches
            .filter(b => b.head_commit && localBranches.has(b.name))
            .filter(b => peerLastSeen.get(`${entry.id}:${b.name}`) !== b.head_commit)
            .map(b => b.name)
          if (changedBranches.length > 0) toSync.push({ id: entry.id, branchNames: changedBranches })
        }

        if (toSync.length === 0) {
          // No structural changes. Still refresh metadata (album edits, artwork
          // set after tracks were added) so they propagate without a new commit.
          const sharedIds = manifest.filter(e => localIds.has(e.id)).map(e => e.id)
          if (sharedIds.length > 0) {
            const artDownloaded = await invoke<number>('sync_refresh_metadata', {
              publicKeyB64: peer.public_key_b64,
              playlistIds: sharedIds,
            }).catch(() => 0)
            if (artDownloaded > 0) {
              await Promise.all([get().loadPlaylists(), get().loadLibrary()])
              get().bumpArtworkVersion()
            }
          }
          return
        }

        let synced = 0
        let conflicted = 0
        for (const { id, branchNames } of toSync) {
          try {
            const report: SyncReport = branchNames.length === 1
              ? await invoke('sync_playlist', { playlistId: id, branchName: branchNames[0], publicKeyB64: peer.public_key_b64 })
              : await invoke('sync_playlist_branches', { playlistId: id, branchNames, publicKeyB64: peer.public_key_b64 })
            if (report.conflicts.length > 0) {
              get().openDiffViewer(id, report.conflicts)
              conflicted++
            } else {
              synced++
            }
          } catch { /* peer went offline mid-sync */ }
        }

        if (synced > 0 || conflicted > 0) {
          await Promise.all([get().loadPlaylists(), get().loadLibrary()])
          set(s => ({ syncVersion: s.syncVersion + 1 }))
          if (conflicted > 0) {
            showToast(`Synced with ${peer.display_name} — ${conflicted} conflict${conflicted !== 1 ? 's' : ''} need resolution`)
          } else {
            showToast(`Auto-synced ${synced} playlist${synced !== 1 ? 's' : ''} with ${peer.display_name}`)
          }
        }
      })
      .catch(() => {})
      .finally(() => syncingPeers.delete(peer.public_key_b64))
  }

  return ({
  mergeConflicts:           [],
  mergePlaylistId:          null,
  currentChunkIdx:          0,
  resolutions:              [],
  diffViewerOpen:           false,
  pendingConflictPlaylists: [],

  openDiffViewer: (playlistId, conflicts) => set(s => ({
    mergePlaylistId:          playlistId,
    mergeConflicts:           conflicts,
    currentChunkIdx:          0,
    resolutions:              [],
    diffViewerOpen:           true,
    pendingConflictPlaylists: s.pendingConflictPlaylists.includes(playlistId)
      ? s.pendingConflictPlaylists
      : [...s.pendingConflictPlaylists, playlistId],
  })),

  closeDiffViewer: () => set({ diffViewerOpen: false }),

  submitResolution: (resolution) => set(state => ({
    resolutions:     [...state.resolutions, resolution],
    currentChunkIdx: state.currentChunkIdx + 1,
  })),

  finalizeMerge: async () => {
    const { mergePlaylistId, resolutions } = get()
    try {
      await invoke('resolve_merge_conflict', { playlistId: mergePlaylistId, resolutions })
      set(s => ({
        mergeConflicts:           [],
        mergePlaylistId:          null,
        currentChunkIdx:          0,
        resolutions:              [],
        diffViewerOpen:           false,
        pendingConflictPlaylists: s.pendingConflictPlaylists.filter(id => id !== mergePlaylistId),
      }))
      await Promise.all([get().loadPlaylists(), get().loadLibrary()])
      get().bumpArtworkVersion()
      showToast('Merge resolved — playlist updated')
    } catch (e) {
      showToast(`Merge failed: ${String(e).slice(0, 60)}`)
    }
  },

  reopenConflict: async (playlistId) => {
    try {
      const conflicts = await invoke<ConflictChunk[]>('sync_get_pending_conflicts', { playlistId })
      if (conflicts.length > 0) {
        get().openDiffViewer(playlistId, conflicts)
      } else {
        // Pending merge cleared (app restarted). Remove stale badge.
        set(s => ({ pendingConflictPlaylists: s.pendingConflictPlaylists.filter(id => id !== playlistId) }))
        // If the last known conflicts are still in memory for this playlist, reuse them.
        const { mergeConflicts, mergePlaylistId } = get()
        if (mergePlaylistId === playlistId && mergeConflicts.length > 0) {
          set({ diffViewerOpen: true })
        }
      }
    } catch {
      const { mergeConflicts, mergePlaylistId } = get()
      if (mergePlaylistId === playlistId && mergeConflicts.length > 0) {
        set({ diffViewerOpen: true })
      }
    }
  },

  artworkVersion: 0,
  bumpArtworkVersion: () => set(s => ({ artworkVersion: s.artworkVersion + 1 })),

  syncVersion: 0,

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
    await Promise.all([get().refreshKnownDevices(), get().refreshLivePeers()])
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
    // triggerAutoSync diffs against lastSeenHeads and skips if nothing changed,
    // so it's safe to call on every poll — the fast path costs one manifest fetch.
    for (const peer of peers) triggerAutoSync(peer)
  },

  syncWithPeer: async (publicKeyB64) => {
    const peer = get().livePeers.find(p => p.public_key_b64 === publicKeyB64)
    const peerName = peer?.display_name ?? 'device'
    try {
      const report = await invoke<SyncReport>('sync_with_peer', { publicKeyB64 })
      await Promise.all([get().loadPlaylists(), get().loadLibrary()])
      if (report.conflicts.length > 0) {
        // The aggregate report has conflicts from multiple playlists merged together.
        // Each one is stored as a pending merge in Rust keyed by playlist_id.
        // Scan all local playlists to find which ones have pending merges and open
        // the diff viewer for the first one found (subsequent ones get a badge).
        const { playlists } = get()
        let opened = false
        for (const pl of playlists) {
          const conflicts = await invoke<ConflictChunk[]>('sync_get_pending_conflicts', { playlistId: pl.id }).catch(() => [] as ConflictChunk[])
          if (conflicts.length > 0) {
            if (!opened) {
              get().openDiffViewer(pl.id, conflicts)
              opened = true
            } else {
              // Register badge for remaining conflicted playlists
              set(s => ({
                pendingConflictPlaylists: s.pendingConflictPlaylists.includes(pl.id)
                  ? s.pendingConflictPlaylists
                  : [...s.pendingConflictPlaylists, pl.id],
              }))
            }
          }
        }
        showToast(`Synced with ${peerName} — ${report.conflicts.length} conflict${report.conflicts.length !== 1 ? 's' : ''} need resolution`)
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
    const publicKeyB64 = get().peerManifestPeer?.public_key_b64 ?? null
    set(state => ({ downloadingPlaylists: [...state.downloadingPlaylists, playlistId] }))
    try {
      const report = branchNames.length === 1
        ? await invoke<SyncReport>('sync_playlist', { playlistId, branchName: branchNames[0], publicKeyB64 })
        : await invoke<SyncReport>('sync_playlist_branches', { playlistId, branchNames, publicKeyB64 })
      set(state => ({
        downloadingPlaylists: state.downloadingPlaylists.filter(id => id !== playlistId),
        downloadProgress: (() => { const n = { ...state.downloadProgress }; delete n[playlistId]; return n })(),
      }))
      await Promise.all([get().loadPlaylists(), get().loadLibrary()])
      get().bumpArtworkVersion()

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

