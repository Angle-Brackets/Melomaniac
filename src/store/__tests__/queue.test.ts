import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createQueueSlice, QueueSlice } from '../queueSlice'
import { RepeatMode, ShuffleMode } from '../types'

const TRACKS = ['a', 'b', 'c', 'd', 'e']

function makeStore() {
  return createStore<QueueSlice>()((...a) => createQueueSlice(...a))
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
})

// ── loadQueue ─────────────────────────────────────────────────────────────────

describe('loadQueue', () => {
  it('sets tracks and resets position to 0', () => {
    store.getState().loadQueue(TRACKS)
    const s = store.getState()
    expect(s.queueTracks).toEqual(TRACKS)
    expect(s.currentIndex).toBe(0)
    expect(s.shuffledQueue).toEqual([])
    expect(s.shuffleIndex).toBe(0)
  })

  it('replaces an existing queue', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().loadQueue(['x', 'y'])
    expect(store.getState().queueTracks).toEqual(['x', 'y'])
  })

  it('triggers shuffle refill when shuffle is active', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(TRACKS)
    expect(store.getState().shuffledQueue.length).toBeGreaterThan(0)
  })
})

// ── currentHash ───────────────────────────────────────────────────────────────

describe('currentHash', () => {
  it('returns null on empty queue', () => {
    expect(store.getState().currentHash()).toBeNull()
  })

  it('returns the track at currentIndex when shuffle is off', () => {
    store.getState().loadQueue(TRACKS)
    expect(store.getState().currentHash()).toBe('a')
  })

  it('returns from shuffledQueue when shuffle is on', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(TRACKS)
    const hash = store.getState().currentHash()
    expect(TRACKS).toContain(hash)
  })
})

// ── advance ───────────────────────────────────────────────────────────────────

describe('advance (shuffle off)', () => {
  it('moves to the next track', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().advance()
    expect(store.getState().currentIndex).toBe(1)
  })

  it('stops at the last track without RepeatMode.All', () => {
    store.getState().loadQueue(TRACKS)
    for (let i = 0; i < TRACKS.length + 5; i++) store.getState().advance()
    expect(store.getState().currentIndex).toBe(TRACKS.length - 1)
  })

  it('wraps back to 0 with RepeatMode.All', () => {
    store.getState().setRepeat(RepeatMode.All)
    store.getState().loadQueue(TRACKS)
    for (let i = 0; i < TRACKS.length; i++) store.getState().advance()
    expect(store.getState().currentIndex).toBe(0)
  })
})

describe('advance (shuffle on)', () => {
  it('increments shuffleIndex', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(TRACKS)
    const before = store.getState().shuffleIndex
    store.getState().advance()
    expect(store.getState().shuffleIndex).toBe(before + 1)
  })
})

// ── retreat ───────────────────────────────────────────────────────────────────

describe('retreat', () => {
  it('decrements currentIndex', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().advance()
    store.getState().retreat()
    expect(store.getState().currentIndex).toBe(0)
  })

  it('does not go below 0', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().retreat()
    expect(store.getState().currentIndex).toBe(0)
  })

  it('decrements shuffleIndex when shuffle is on', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(TRACKS)
    store.getState().advance()
    const before = store.getState().shuffleIndex
    store.getState().retreat()
    expect(store.getState().shuffleIndex).toBe(before - 1)
  })
})

// ── jumpTo ────────────────────────────────────────────────────────────────────

describe('jumpTo', () => {
  it('sets currentIndex to the given index', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().jumpTo(3)
    expect(store.getState().currentIndex).toBe(3)
  })

  it('ignores out-of-bounds indices', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().jumpTo(99)
    expect(store.getState().currentIndex).toBe(0)
    store.getState().jumpTo(-1)
    expect(store.getState().currentIndex).toBe(0)
  })
})

// ── refillShuffleQueue ────────────────────────────────────────────────────────

describe('ShuffleMode.Smart', () => {
  it('produces a permutation of all tracks (no duplicates, all present)', () => {
    store.getState().setShuffle(ShuffleMode.Smart)
    store.getState().loadQueue(TRACKS)
    const batch = store.getState().shuffledQueue.slice(0, TRACKS.length)
    expect([...batch].sort()).toEqual([...TRACKS].sort())
  })
})

describe('ShuffleMode.Random', () => {
  it('pre-generates up to lookahead picks', () => {
    store.getState().setShuffle(ShuffleMode.Random)
    store.getState().loadQueue(TRACKS)
    const { shuffledQueue, lookahead } = store.getState()
    expect(shuffledQueue.length).toBeLessThanOrEqual(lookahead)
    shuffledQueue.forEach((h) => expect(TRACKS).toContain(h))
  })
})

describe('setShuffle', () => {
  it('clears shuffle state before refilling', () => {
    store.getState().loadQueue(TRACKS)
    store.getState().setShuffle(ShuffleMode.Smart)
    const first = [...store.getState().shuffledQueue]
    store.getState().setShuffle(ShuffleMode.Off)
    expect(store.getState().shuffledQueue).toEqual([])
    store.getState().setShuffle(ShuffleMode.Smart)
    // After a reset the queue is freshly generated (may differ from first)
    expect(store.getState().shuffledQueue).not.toHaveLength(0)
    // Suppress unused-variable lint; we just want both to be valid permutations
    void first
  })
})
