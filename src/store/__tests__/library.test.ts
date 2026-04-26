import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createLibrarySlice, LibrarySlice } from '../librarySlice'
import type { TrackRecord } from '../types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

function makeStore() {
  return createStore<LibrarySlice>()((...a) => createLibrarySlice(...a))
}

function track(hash: string, favorited = false): TrackRecord {
  return { hash, title: 'T', artist: 'A', album: null, artwork_hash: null, duration_ms: 1000, favorited }
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
  vi.clearAllMocks()
})

// ── loadLibrary ───────────────────────────────────────────────────────────────

describe('loadLibrary', () => {
  it('sets libraryStatus to loading then ready on success', async () => {
    const tracks = [track('aa'), track('bb')]
    mockInvoke.mockResolvedValueOnce(tracks)

    const promise = store.getState().loadLibrary()
    expect(store.getState().libraryStatus).toBe('loading')
    await promise
    expect(store.getState().libraryStatus).toBe('ready')
    expect(store.getState().tracks).toEqual(tracks)
  })

  it('sets libraryStatus to error when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('db offline'))
    await store.getState().loadLibrary()
    expect(store.getState().libraryStatus).toBe('error')
    expect(store.getState().tracks).toEqual([])
  })

  it('calls library_get_all', async () => {
    mockInvoke.mockResolvedValueOnce([])
    await store.getState().loadLibrary()
    expect(mockInvoke).toHaveBeenCalledWith('library_get_all')
  })
})

// ── toggleFavorite ────────────────────────────────────────────────────────────

describe('toggleFavorite', () => {
  it('is a no-op when hash is not in library', () => {
    store.getState().toggleFavorite('unknown')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('optimistically flips favorited', async () => {
    mockInvoke.mockResolvedValueOnce([track('aa')])
    await store.getState().loadLibrary()

    mockInvoke.mockResolvedValueOnce(undefined)
    store.getState().toggleFavorite('aa')
    expect(store.getState().tracks.find((t) => t.hash === 'aa')?.favorited).toBe(true)
  })

  it('calls library_set_favorite with correct args', async () => {
    mockInvoke.mockResolvedValueOnce([track('aa', false)])
    await store.getState().loadLibrary()

    mockInvoke.mockResolvedValueOnce(undefined)
    store.getState().toggleFavorite('aa')
    expect(mockInvoke).toHaveBeenCalledWith('library_set_favorite', { hash: 'aa', favorited: true })
  })

  it('rolls back on invoke failure', async () => {
    mockInvoke.mockResolvedValueOnce([track('aa', false)])
    await store.getState().loadLibrary()

    mockInvoke.mockRejectedValueOnce(new Error('write failed'))
    store.getState().toggleFavorite('aa')

    // flush microtask queue so the catch handler runs
    await new Promise((r) => setTimeout(r, 0))
    expect(store.getState().tracks.find((t) => t.hash === 'aa')?.favorited).toBe(false)
  })

  it('toggles back to unfavorited', async () => {
    mockInvoke.mockResolvedValueOnce([track('aa', true)])
    await store.getState().loadLibrary()

    mockInvoke.mockResolvedValueOnce(undefined)
    store.getState().toggleFavorite('aa')
    expect(store.getState().tracks.find((t) => t.hash === 'aa')?.favorited).toBe(false)
  })
})
