import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createSyncSlice, SyncSlice } from '../syncSlice'
import { createLibrarySlice } from '../librarySlice'
import { createPlaybackSlice } from '../playbackSlice'
import { createPlaylistSlice } from '../playlistSlice'
import { createQueueSlice } from '../queueSlice'
import type { StoreState } from '../index'
import type { ConflictChunk, ConflictResolution } from '../types'

// ── Mock Tauri APIs ───────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore() {
  return createStore<StoreState>()((...a) => ({
    ...createPlaybackSlice(...a),
    ...createQueueSlice(...a),
    ...createLibrarySlice(...a),
    ...createPlaylistSlice(...a),
    ...createSyncSlice(...a),
  }))
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function chunk(id: string): ConflictChunk {
  return {
    id,
    kind: 'TrackOrder',
    ours: ['a', 'b'],
    theirs: ['b', 'a'],
    context: ['a', 'b'],
  }
}

function resolution(id: string): ConflictResolution {
  return { conflict_id: id, choice: 'KeepOurs' }
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
  vi.clearAllMocks()
})

// ── openDiffViewer ────────────────────────────────────────────────────────────

describe('openDiffViewer', () => {
  it('sets mergePlaylistId and mergeConflicts', () => {
    const conflicts = [chunk('c1'), chunk('c2')]
    store.getState().openDiffViewer('playlist-1', conflicts)

    const s = store.getState()
    expect(s.mergePlaylistId).toBe('playlist-1')
    expect(s.mergeConflicts).toEqual(conflicts)
  })

  it('resets resolutions to empty', () => {
    // Simulate having existing resolutions from a previous round
    store.setState({ resolutions: [resolution('old')] })
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    expect(store.getState().resolutions).toEqual([])
  })

  it('resets currentChunkIdx to 0', () => {
    store.setState({ currentChunkIdx: 3 })
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    expect(store.getState().currentChunkIdx).toBe(0)
  })

  it('adds playlist to pendingConflictPlaylists', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    expect(store.getState().pendingConflictPlaylists).toContain('playlist-1')
  })

  it('does not duplicate playlist in pendingConflictPlaylists if called twice', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().openDiffViewer('playlist-1', [chunk('c2')])

    const ids = store.getState().pendingConflictPlaylists.filter(id => id === 'playlist-1')
    expect(ids).toHaveLength(1)
  })

  it('adds a new playlist without removing existing ones', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().openDiffViewer('playlist-2', [chunk('c2')])

    const ids = store.getState().pendingConflictPlaylists
    expect(ids).toContain('playlist-1')
    expect(ids).toContain('playlist-2')
  })
})

// ── submitResolution ──────────────────────────────────────────────────────────

describe('submitResolution', () => {
  it('appends the resolution to resolutions array', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1'), chunk('c2')])
    store.getState().submitResolution(resolution('c1'))

    expect(store.getState().resolutions).toHaveLength(1)
    expect(store.getState().resolutions[0].conflict_id).toBe('c1')
  })

  it('increments currentChunkIdx', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1'), chunk('c2')])
    expect(store.getState().currentChunkIdx).toBe(0)

    store.getState().submitResolution(resolution('c1'))
    expect(store.getState().currentChunkIdx).toBe(1)
  })

  it('accumulates multiple resolutions in order', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1'), chunk('c2'), chunk('c3')])
    store.getState().submitResolution(resolution('c1'))
    store.getState().submitResolution(resolution('c2'))
    store.getState().submitResolution(resolution('c3'))

    const res = store.getState().resolutions
    expect(res).toHaveLength(3)
    expect(res.map(r => r.conflict_id)).toEqual(['c1', 'c2', 'c3'])
  })
})

// ── finalizeMerge ─────────────────────────────────────────────────────────────

describe('finalizeMerge — successful resolution', () => {
  beforeEach(async () => {
    // loadPlaylists and loadLibrary are called after a successful merge.
    // Stub them out so they don't fail.
    mockInvoke.mockResolvedValue([])
  })

  it('calls resolve_merge_conflict with correct args', async () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().submitResolution(resolution('c1'))

    await store.getState().finalizeMerge()

    expect(mockInvoke).toHaveBeenCalledWith('resolve_merge_conflict', {
      playlistId: 'playlist-1',
      resolutions: [resolution('c1')],
    })
  })

  it('clears mergeConflicts after successful resolution', async () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().submitResolution(resolution('c1'))

    await store.getState().finalizeMerge()

    expect(store.getState().mergeConflicts).toEqual([])
  })

  it('removes playlist from pendingConflictPlaylists after resolution', async () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().submitResolution(resolution('c1'))

    await store.getState().finalizeMerge()

    expect(store.getState().pendingConflictPlaylists).not.toContain('playlist-1')
  })

  it('clears mergePlaylistId after resolution', async () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().submitResolution(resolution('c1'))

    await store.getState().finalizeMerge()

    expect(store.getState().mergePlaylistId).toBeNull()
  })

  it('does not remove other playlists from pendingConflictPlaylists', async () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().openDiffViewer('playlist-2', [chunk('c2')])
    // Reopen playlist-1 to set it as current target
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    store.getState().submitResolution(resolution('c1'))

    await store.getState().finalizeMerge()

    expect(store.getState().pendingConflictPlaylists).toContain('playlist-2')
    expect(store.getState().pendingConflictPlaylists).not.toContain('playlist-1')
  })
})

// ── finalizeMerge — failure ───────────────────────────────────────────────────

describe('finalizeMerge — invoke failure', () => {
  it('does not clear mergeConflicts when invoke rejects', async () => {
    const conflicts = [chunk('c1')]
    store.getState().openDiffViewer('playlist-1', conflicts)
    store.getState().submitResolution(resolution('c1'))

    mockInvoke.mockRejectedValueOnce(new Error('db locked'))

    await store.getState().finalizeMerge()

    // Conflicts should remain untouched so the user can retry
    expect(store.getState().mergeConflicts).toEqual(conflicts)
    expect(store.getState().pendingConflictPlaylists).toContain('playlist-1')
  })
})

// ── pendingConflictPlaylists — deduplication ──────────────────────────────────

describe('pendingConflictPlaylists deduplication', () => {
  it('calling openDiffViewer twice for the same playlist keeps exactly one entry', () => {
    store.getState().openDiffViewer('playlist-42', [chunk('c1')])
    store.getState().openDiffViewer('playlist-42', [chunk('c2')])

    const dupes = store.getState().pendingConflictPlaylists.filter(id => id === 'playlist-42')
    expect(dupes).toHaveLength(1)
  })
})

// ── downloadProgress ──────────────────────────────────────────────────────────

describe('downloadProgress', () => {
  it('setDownloadProgress stores progress by playlistId', () => {
    store.getState().setDownloadProgress('pl-1', 0.5)
    expect(store.getState().downloadProgress['pl-1']).toBe(0.5)
  })

  it('clearDownloadProgress removes the entry', () => {
    store.getState().setDownloadProgress('pl-1', 0.8)
    store.getState().clearDownloadProgress('pl-1')
    expect(store.getState().downloadProgress['pl-1']).toBeUndefined()
  })

  it('tracks multiple playlists independently', () => {
    store.getState().setDownloadProgress('pl-1', 0.3)
    store.getState().setDownloadProgress('pl-2', 0.7)
    expect(store.getState().downloadProgress['pl-1']).toBe(0.3)
    expect(store.getState().downloadProgress['pl-2']).toBe(0.7)
  })

  it('clearing one playlist does not affect another', () => {
    store.getState().setDownloadProgress('pl-1', 0.3)
    store.getState().setDownloadProgress('pl-2', 0.7)
    store.getState().clearDownloadProgress('pl-1')
    expect(store.getState().downloadProgress['pl-2']).toBe(0.7)
    expect(store.getState().downloadProgress['pl-1']).toBeUndefined()
  })
})

// ── closeDiffViewer ───────────────────────────────────────────────────────────

describe('closeDiffViewer', () => {
  it('sets diffViewerOpen to false without clearing pendingConflictPlaylists', () => {
    store.getState().openDiffViewer('playlist-1', [chunk('c1')])
    expect(store.getState().diffViewerOpen).toBe(true)

    store.getState().closeDiffViewer()
    expect(store.getState().diffViewerOpen).toBe(false)
    // Badge should still be visible after closing
    expect(store.getState().pendingConflictPlaylists).toContain('playlist-1')
  })
})
