import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createQueueSlice } from '../queueSlice'
import { createLibrarySlice } from '../librarySlice'
import { createPlaybackSlice } from '../playbackSlice'
import { createPlaylistSlice } from '../playlistSlice'
import { createSyncSlice } from '../syncSlice'
import type { StoreState } from '../index'
import { RepeatMode, ShuffleMode } from '../types'

const HASHES = ['a', 'b', 'c', 'd', 'e']

// Minimal TrackRecord stubs — only hash and artist matter for shuffle tests
function makeTracks(entries: { hash: string; artist: string }[]) {
  return entries.map(({ hash, artist }) => ({
    hash, artist,
    title: hash, album: null, artwork_hash: null,
    duration_ms: 0, favorited: false, mime_type: null,
    ingested_at: 0, source_url: null,
  }))
}

function makeStore() {
  return createStore<StoreState>()((...a) => ({
    ...createPlaybackSlice(...a),
    ...createQueueSlice(...a),
    ...createLibrarySlice(...a),
    ...createPlaylistSlice(...a),
    ...createSyncSlice(...a),
  }))
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
})

// ── loadQueue ─────────────────────────────────────────────────────────────────

describe('loadQueue', () => {
  it('sets tracks and resets position to 0', () => {
    store.getState().loadQueue(HASHES)
    const s = store.getState()
    expect(s.queueTracks).toEqual(HASHES)
    expect(s.currentIndex).toBe(0)
    expect(s.shuffledQueue).toEqual([])
    expect(s.shuffleIndex).toBe(0)
  })

  it('replaces an existing queue', () => {
    store.getState().loadQueue(HASHES)
    store.getState().loadQueue(['x', 'y'])
    expect(store.getState().queueTracks).toEqual(['x', 'y'])
  })

  it('triggers shuffle refill when shuffle is active', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    expect(store.getState().shuffledQueue.length).toBeGreaterThan(0)
  })
})

// ── currentHash ───────────────────────────────────────────────────────────────

describe('currentHash', () => {
  it('returns null on empty queue', () => {
    expect(store.getState().currentHash()).toBeNull()
  })

  it('returns the track at currentIndex when shuffle is off', () => {
    store.getState().loadQueue(HASHES)
    expect(store.getState().currentHash()).toBe('a')
  })

  it('returns from shuffledQueue when shuffle is on', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    const hash = store.getState().currentHash()
    expect(HASHES).toContain(hash)
  })
})

// ── advance ───────────────────────────────────────────────────────────────────

describe('advance (shuffle off)', () => {
  it('moves to the next track', () => {
    store.getState().loadQueue(HASHES)
    store.getState().advance()
    expect(store.getState().currentIndex).toBe(1)
  })

  it('stops at the last track without RepeatMode.All', () => {
    store.getState().loadQueue(HASHES)
    for (let i = 0; i < HASHES.length + 5; i++) store.getState().advance()
    expect(store.getState().currentIndex).toBe(HASHES.length - 1)
  })

  it('wraps back to 0 with RepeatMode.All', () => {
    store.getState().setRepeat(RepeatMode.All)
    store.getState().loadQueue(HASHES)
    for (let i = 0; i < HASHES.length; i++) store.getState().advance()
    expect(store.getState().currentIndex).toBe(0)
  })
})

describe('advance (shuffle on)', () => {
  it('increments shuffleIndex', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    const before = store.getState().shuffleIndex
    store.getState().advance()
    expect(store.getState().shuffleIndex).toBe(before + 1)
  })
})

// ── retreat ───────────────────────────────────────────────────────────────────

describe('retreat', () => {
  it('decrements currentIndex', () => {
    store.getState().loadQueue(HASHES)
    store.getState().advance()
    store.getState().retreat()
    expect(store.getState().currentIndex).toBe(0)
  })

  it('does not go below 0', () => {
    store.getState().loadQueue(HASHES)
    store.getState().retreat()
    expect(store.getState().currentIndex).toBe(0)
  })

  it('decrements shuffleIndex when shuffle is on', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    store.getState().advance()
    const before = store.getState().shuffleIndex
    store.getState().retreat()
    expect(store.getState().shuffleIndex).toBe(before - 1)
  })
})

// ── jumpTo ────────────────────────────────────────────────────────────────────

describe('jumpTo', () => {
  it('sets currentIndex to the given index', () => {
    store.getState().loadQueue(HASHES)
    store.getState().jumpTo(3)
    expect(store.getState().currentIndex).toBe(3)
  })

  it('ignores out-of-bounds indices', () => {
    store.getState().loadQueue(HASHES)
    store.getState().jumpTo(99)
    expect(store.getState().currentIndex).toBe(0)
    store.getState().jumpTo(-1)
    expect(store.getState().currentIndex).toBe(0)
  })
})

// ── ShuffleMode.Random (Fisher-Yates) ─────────────────────────────────────────

describe('ShuffleMode.Random', () => {
  it('produces a full permutation — every track present, no duplicates', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    const batch = store.getState().shuffledQueue.slice(0, HASHES.length)
    expect([...batch].sort()).toEqual([...HASHES].sort())
  })

  it('all produced hashes belong to the queue', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(HASHES)
    store.getState().shuffledQueue.forEach(h => expect(HASHES).toContain(h))
  })
})

// ── ShuffleMode.Smart (artist-spread weighted) ────────────────────────────────

describe('ShuffleMode.Smart', () => {
  it('all produced hashes belong to the queue', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(HASHES)
    store.getState().shuffledQueue.forEach(h => expect(HASHES).toContain(h))
  })

  it('strongly avoids placing the same artist back-to-back', () => {
    // 5 tracks: 3 by "ArtistA", 2 by "ArtistB"
    const tracks = makeTracks([
      { hash: 'a1', artist: 'ArtistA' },
      { hash: 'a2', artist: 'ArtistA' },
      { hash: 'a3', artist: 'ArtistA' },
      { hash: 'b1', artist: 'ArtistB' },
      { hash: 'b2', artist: 'ArtistB' },
    ])
    store.setState({ tracks })
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(tracks.map(t => t.hash))

    // Run many trials — back-to-back same artist should be rare (not guaranteed zero,
    // but statistically should be < 20% of transitions with ARTIST_PENALTY = 0.25)
    let consecutive = 0
    let trials = 0
    for (let run = 0; run < 50; run++) {
      store.setState({ shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0 })
      store.getState().refillShuffleQueue()
      const q = store.getState().shuffledQueue
      for (let i = 1; i < q.length; i++) {
        const prev = tracks.find(t => t.hash === q[i - 1])?.artist
        const curr = tracks.find(t => t.hash === q[i])?.artist
        if (prev === curr) consecutive++
        trials++
      }
    }
    // Allow up to 15% back-to-back same-artist (unbiased random would be ~56% for 3/5 ArtistA)
    expect(consecutive / trials).toBeLessThan(0.15)
  })
})

// ── setShuffle ────────────────────────────────────────────────────────────────

describe('setShuffle', () => {
  it('clears shuffle state before refilling', () => {
    store.getState().loadQueue(HASHES)
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().setShuffle(ShuffleMode.Off)
    expect(store.getState().shuffledQueue).toEqual([])
    store.getState().setShuffle(ShuffleMode.Random)
    expect(store.getState().shuffledQueue).not.toHaveLength(0)
  })
})
