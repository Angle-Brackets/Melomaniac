import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import {
  getTrackArtwork,
  getPlaylistArtwork,
  getCachedTrackArtwork,
  getCachedPlaylistArtwork,
  subscribeTrackArtwork,
  subscribePlaylistArtwork,
} from '../artworkCache'

const mockInvoke = vi.mocked(invoke)

// Each test uses a unique hash via this counter so tests don't share cache
// entries — the module-level Maps persist for the entire test run.
let n = 0
const uid = () => `test-hash-${++n}`

beforeEach(() => {
  vi.clearAllMocks()
})

// ── getTrackArtwork ───────────────────────────────────────────────────────────

describe('getTrackArtwork', () => {
  it('calls track_get_artwork on cache miss', async () => {
    const h = uid()
    mockInvoke.mockResolvedValueOnce('data:image/jpeg;base64,abc')
    const url = await getTrackArtwork(h, 'art-hash')
    expect(url).toBe('data:image/jpeg;base64,abc')
    expect(mockInvoke).toHaveBeenCalledWith('track_get_artwork', { hash: h })
  })

  it('returns cached value without a second invoke', async () => {
    const h = uid()
    mockInvoke.mockResolvedValueOnce('data:image/png;base64,xyz')
    await getTrackArtwork(h, 'art-hash')
    vi.clearAllMocks()

    const url = await getTrackArtwork(h, 'art-hash')
    expect(url).toBe('data:image/png;base64,xyz')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent requests — returns the same Promise and calls invoke once', async () => {
    const h = uid()
    let resolve!: (v: string) => void
    const pending = new Promise<string>(r => { resolve = r })
    mockInvoke.mockReturnValueOnce(pending)

    const p1 = getTrackArtwork(h, 'art-hash')
    const p2 = getTrackArtwork(h, 'art-hash')
    expect(p1).toBe(p2)

    resolve('data:image/webp;base64,dedup')
    await p1
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('returns null on invoke failure', async () => {
    const h = uid()
    mockInvoke.mockRejectedValueOnce(new Error('blob missing'))
    const url = await getTrackArtwork(h, 'art-hash')
    expect(url).toBeNull()
  })

  it('does not cache a failure — retries invoke on the next call', async () => {
    const h = uid()
    mockInvoke.mockRejectedValueOnce(new Error('first fail'))
    await getTrackArtwork(h, 'art-hash')

    mockInvoke.mockResolvedValueOnce('data:image/jpeg;base64,retry')
    const url = await getTrackArtwork(h, 'art-hash')
    expect(url).toBe('data:image/jpeg;base64,retry')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })
})

// ── getCachedTrackArtwork ─────────────────────────────────────────────────────

describe('getCachedTrackArtwork', () => {
  it('returns null before any fetch for that hash', () => {
    expect(getCachedTrackArtwork(uid())).toBeNull()
  })

  it('returns the url synchronously after a successful fetch', async () => {
    const h = uid()
    mockInvoke.mockResolvedValueOnce('data:image/jpeg;base64,sync')
    await getTrackArtwork(h, 'art-hash')
    expect(getCachedTrackArtwork(h)).toBe('data:image/jpeg;base64,sync')
  })

  it('returns null after a failed fetch (nothing stored)', async () => {
    const h = uid()
    mockInvoke.mockRejectedValueOnce(new Error('fail'))
    await getTrackArtwork(h, 'art-hash')
    expect(getCachedTrackArtwork(h)).toBeNull()
  })
})

// ── Subscriber notifications ──────────────────────────────────────────────────

describe('subscribeTrackArtwork', () => {
  it('notifies the subscriber once when the fetch resolves', async () => {
    const h = uid()
    const cb = vi.fn()
    const unsub = subscribeTrackArtwork(h, cb)
    mockInvoke.mockResolvedValueOnce('data:...')
    await getTrackArtwork(h, 'art-hash')
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('does not notify after the subscriber unsubscribes', async () => {
    const h = uid()
    const cb = vi.fn()
    const unsub = subscribeTrackArtwork(h, cb)
    unsub()
    mockInvoke.mockResolvedValueOnce('data:...')
    await getTrackArtwork(h, 'art-hash')
    expect(cb).not.toHaveBeenCalled()
  })

  it('notifies multiple independent subscribers', async () => {
    const h = uid()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const u1 = subscribeTrackArtwork(h, cb1)
    const u2 = subscribeTrackArtwork(h, cb2)
    mockInvoke.mockResolvedValueOnce('data:...')
    await getTrackArtwork(h, 'art-hash')
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
    u1(); u2()
  })

  it('does not notify a subscriber registered for a different hash', async () => {
    const h1 = uid()
    const h2 = uid()
    const cb = vi.fn()
    const unsub = subscribeTrackArtwork(h1, cb)
    mockInvoke.mockResolvedValueOnce('data:...')
    await getTrackArtwork(h2, 'art-hash')
    expect(cb).not.toHaveBeenCalled()
    unsub()
  })
})

// ── getPlaylistArtwork ────────────────────────────────────────────────────────

describe('getPlaylistArtwork', () => {
  it('calls playlist_get_artwork with playlistId and branchName', async () => {
    mockInvoke.mockResolvedValueOnce('data:pl')
    await getPlaylistArtwork('pl-1', 'main')
    expect(mockInvoke).toHaveBeenCalledWith('playlist_get_artwork', {
      playlistId: 'pl-1',
      branchName: 'main',
    })
  })

  it('defaults branchName to main', async () => {
    mockInvoke.mockResolvedValueOnce('data:pl-default')
    await getPlaylistArtwork('pl-2')
    expect(mockInvoke).toHaveBeenCalledWith('playlist_get_artwork', {
      playlistId: 'pl-2',
      branchName: 'main',
    })
  })

  it('caches main and feature branches independently', async () => {
    mockInvoke.mockResolvedValueOnce('data:main')
    mockInvoke.mockResolvedValueOnce('data:feature')
    await getPlaylistArtwork('pl-3', 'main')
    await getPlaylistArtwork('pl-3', 'feature')
    expect(getCachedPlaylistArtwork('pl-3', 'main')).toBe('data:main')
    expect(getCachedPlaylistArtwork('pl-3', 'feature')).toBe('data:feature')
  })

  it('notifies playlist subscribers after fetch', async () => {
    const cb = vi.fn()
    const unsub = subscribePlaylistArtwork('pl-4::main', cb)
    mockInvoke.mockResolvedValueOnce('data:pl-notify')
    await getPlaylistArtwork('pl-4', 'main')
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })
})
