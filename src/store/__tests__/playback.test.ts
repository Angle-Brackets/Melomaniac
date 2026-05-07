import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createPlaybackSlice, PlaybackSlice } from '../playbackSlice'

function makeStore() {
  return createStore<PlaybackSlice>()((...a) => createPlaybackSlice(...a))
}

let store: ReturnType<typeof makeStore>

beforeEach(() => {
  store = makeStore()
})

describe('initial state', () => {
  it('has expected defaults', () => {
    const s = store.getState()
    expect(s.isPlaying).toBe(false)
    expect(s.loadedTrackHash).toBeNull()
    expect(s.duration_ms).toBe(0)
    expect(s.volume).toBe(1)
  })
})

describe('setPlaying', () => {
  it('sets isPlaying to true', () => {
    store.getState().setPlaying(true)
    expect(store.getState().isPlaying).toBe(true)
  })

  it('sets isPlaying to false', () => {
    store.getState().setPlaying(true)
    store.getState().setPlaying(false)
    expect(store.getState().isPlaying).toBe(false)
  })
})

describe('setLoaded', () => {
  it('sets loadedTrackHash and duration_ms', () => {
    store.getState().setLoaded('abc123', 180000)
    const s = store.getState()
    expect(s.loadedTrackHash).toBe('abc123')
    expect(s.duration_ms).toBe(180000)
  })
})

describe('setVolume', () => {
  it('sets volume within range', () => {
    store.getState().setVolume(0.5)
    expect(store.getState().volume).toBe(0.5)
  })

  it('clamps negative values to 0', () => {
    store.getState().setVolume(-0.1)
    expect(store.getState().volume).toBe(0)
  })

  it('clamps values above 1 to 1', () => {
    store.getState().setVolume(1.5)
    expect(store.getState().volume).toBe(1)
  })
})
