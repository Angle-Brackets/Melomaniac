import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createPlaylistSlice, PlaylistSlice } from '../playlistSlice'
import type { PlaylistRecord } from '../types'
import { LoadStatus } from '../types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

function makeStore() {
  return createStore<PlaylistSlice>()((...a) => createPlaylistSlice(...a))
}

function playlist(id: string): PlaylistRecord {
  return { id, name: `Playlist ${id}`, description: null, created_at: 0, forked_from: null, branches: [] }
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
  vi.clearAllMocks()
})

// ── initial state ─────────────────────────────────────────────────────────────

it('starts idle with no playlists selected', () => {
  const s = store.getState()
  expect(s.playlists).toEqual([])
  expect(s.currentPlaylistId).toBeNull()
  expect(s.currentBranchName).toBe('main')
  expect(s.playlistStatus).toBe(LoadStatus.Idle)
})

// ── loadPlaylists ─────────────────────────────────────────────────────────────

describe('loadPlaylists', () => {
  it('sets status to loading then ready on success', async () => {
    const playlists = [playlist('p1'), playlist('p2')]
    mockInvoke.mockResolvedValueOnce(playlists)

    const promise = store.getState().loadPlaylists()
    expect(store.getState().playlistStatus).toBe(LoadStatus.Loading)
    await promise
    expect(store.getState().playlistStatus).toBe(LoadStatus.Ready)
    expect(store.getState().playlists).toEqual(playlists)
  })

  it('sets status to error when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('storage error'))
    await store.getState().loadPlaylists()
    expect(store.getState().playlistStatus).toBe(LoadStatus.Error)
    expect(store.getState().playlists).toEqual([])
  })

  it('calls playlist_get_all', async () => {
    mockInvoke.mockResolvedValueOnce([])
    await store.getState().loadPlaylists()
    expect(mockInvoke).toHaveBeenCalledWith('playlist_get_all')
  })
})

// ── setCurrentPlaylist ────────────────────────────────────────────────────────

describe('setCurrentPlaylist', () => {
  it('sets the current playlist id', () => {
    store.getState().setCurrentPlaylist('p1')
    expect(store.getState().currentPlaylistId).toBe('p1')
  })

  it('resets branch to main', () => {
    store.getState().setCurrentBranch('feature')
    store.getState().setCurrentPlaylist('p1')
    expect(store.getState().currentBranchName).toBe('main')
  })
})

// ── setCurrentBranch ──────────────────────────────────────────────────────────

describe('setCurrentBranch', () => {
  it('sets the branch without touching playlist id', () => {
    store.getState().setCurrentPlaylist('p1')
    store.getState().setCurrentBranch('chill-mix')
    expect(store.getState().currentBranchName).toBe('chill-mix')
    expect(store.getState().currentPlaylistId).toBe('p1')
  })
})
