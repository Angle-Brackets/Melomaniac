import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { RepeatMode, ShuffleMode } from './types'
import type { TrackStats } from './types'
import type { StoreState } from './index'
import { fisherYates, pickWeighted, pickDiscovery, pickSmart, pickFavorites } from './shuffleAlgorithms'

// Start topping up before the queue fully drains so the UI always has upcoming tracks to display
const REFILL_THRESHOLD = 5
// How many recent artists to seed pickSmart's lookbehind with, taken from the tail of shuffleHistory
const ARTIST_LOOKBEHIND = 4

export type QueueSlice = {
  queueTracks: string[]  // hashes in original load order
  currentIndex: number   // position in queueTracks when shuffle is Off
  shuffle: ShuffleMode
  repeat: RepeatMode
  shuffledQueue: string[] // pre-computed upcoming hashes; consumed by both shuffle modes
  shuffleHistory: string[] // recently played hashes used to avoid immediate repeats on refill
  shuffleIndex: number    // current position within shuffledQueue
  lookahead: number       // how many tracks to pre-generate per refill (default 20)
  trackPlayCounts: Map<string, number> // hash → play_count; populated on demand for Weighted/Discovery/Favorites
  manualQueue: string[]        // FIFO priority queue — consumed by advance() before the normal linear/shuffle order
  activeManualHash: string | null // set when advance() just pulled a track from manualQueue; overrides currentHash()

  // Selector: encapsulates the shuffle/linear branch so callers don't duplicate it
  currentHash: () => string | null
  loadQueue: (hashes: string[]) => void
  advance: () => void
  retreat: () => void // shifts index only — does not pop shuffleHistory or un-consume manualQueue
  jumpTo: (index: number) => void
  setShuffle: (mode: ShuffleMode) => void
  setRepeat: (mode: RepeatMode) => void
  refillShuffleQueue: () => void
  removeUpcomingTrack: (hash: string) => void
  addToQueue: (hash: string) => void       // "Play Next" — prepend to manualQueue
  appendToQueue: (hash: string) => void    // "Add to Queue" — append to manualQueue
  removeFromManualQueue: (index: number) => void
  clearManualQueue: () => void
}

export const createQueueSlice: StateCreator<StoreState, [], [], QueueSlice> = (set, get) => ({
  queueTracks: [],
  currentIndex: 0,
  shuffle: ShuffleMode.Off,
  repeat: RepeatMode.None,
  shuffledQueue: [],
  shuffleHistory: [],
  shuffleIndex: 0,
  lookahead: 20,
  trackPlayCounts: new Map(),
  manualQueue: [],
  activeManualHash: null,

  currentHash: () => {
    const { queueTracks, currentIndex, shuffle, shuffledQueue, shuffleIndex, activeManualHash } = get()
    if (activeManualHash) return activeManualHash
    if (shuffle !== ShuffleMode.Off) return shuffledQueue[shuffleIndex] ?? null
    return queueTracks[currentIndex] ?? null
  },

  loadQueue: (hashes) => {
    set({
      queueTracks: hashes, currentIndex: 0,
      shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0,
      manualQueue: [], activeManualHash: null,
    })
    if (get().shuffle !== ShuffleMode.Off) get().refillShuffleQueue()
  },

  advance: () => {
    const { manualQueue, queueTracks, currentIndex, shuffle, repeat, shuffledQueue, shuffleIndex } = get()

    if (manualQueue.length > 0) {
      const [next, ...rest] = manualQueue
      set({ manualQueue: rest, activeManualHash: next })
      return
    }
    set({ activeManualHash: null })

    if (shuffle !== ShuffleMode.Off) {
      const next = shuffleIndex + 1
      if (shuffledQueue.length - next < REFILL_THRESHOLD) get().refillShuffleQueue()
      set({ shuffleIndex: next })
    } else {
      const next = currentIndex + 1
      if (next >= queueTracks.length) {
        // RepeatMode.One is handled upstream: the TrackEnded listener reloads the current
        // track instead of calling advance(), so it never reaches here.
        if (repeat === RepeatMode.All) set({ currentIndex: 0 })
      } else {
        set({ currentIndex: next })
      }
    }
  },

  retreat: () => {
    const { currentIndex, shuffle, shuffleIndex } = get()
    set({ activeManualHash: null })
    if (shuffle !== ShuffleMode.Off) {
      set({ shuffleIndex: Math.max(0, shuffleIndex - 1) })
    } else {
      set({ currentIndex: Math.max(0, currentIndex - 1) })
    }
  },

  jumpTo: (index) => {
    const { queueTracks } = get()
    if (index >= 0 && index < queueTracks.length) set({ currentIndex: index, activeManualHash: null })
  },

  setShuffle: async (mode) => {
    const playing = get().currentHash()
    set({ shuffle: mode, shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0 })
    if (mode === ShuffleMode.Weighted || mode === ShuffleMode.Discovery || mode === ShuffleMode.Favorites) {
      try {
        const stats = await invoke<[string, TrackStats][]>('library_get_all_track_stats')
        set({ trackPlayCounts: new Map(stats.map(([h, s]) => [h, s.play_count])) })
      } catch { /* fall back to treating all counts as 0 */ }
    }
    if (mode !== ShuffleMode.Off) {
      get().refillShuffleQueue()
      // Keep the currently playing track at shuffleIndex 0 so currentHash() is stable
      if (playing) {
        const q = get().shuffledQueue
        const idx = q.indexOf(playing)
        if (idx > 0) {
          set({ shuffledQueue: [playing, ...q.filter(h => h !== playing)] })
        } else if (idx === -1) {
          set({ shuffledQueue: [playing, ...q] })
        }
      }
    }
  },

  setRepeat: (mode) => set({ repeat: mode }),

  removeUpcomingTrack: (hash) => {
    const { shuffle, shuffledQueue, shuffleIndex, queueTracks, currentIndex, manualQueue } = get()
    const nextManualQueue = manualQueue.filter(h => h !== hash)
    if (shuffle !== ShuffleMode.Off) {
      const before = shuffledQueue.slice(0, shuffleIndex + 1)
      const after  = shuffledQueue.slice(shuffleIndex + 1).filter(h => h !== hash)
      set({ shuffledQueue: [...before, ...after], manualQueue: nextManualQueue })
    } else {
      const before = queueTracks.slice(0, currentIndex + 1)
      const after  = queueTracks.slice(currentIndex + 1).filter(h => h !== hash)
      set({ queueTracks: [...before, ...after], manualQueue: nextManualQueue })
    }
  },

  // "Play Next" — the added song is the very next thing to play, ahead of the manual
  // queue's existing entries and the natural upcoming queue.
  addToQueue: (hash) => {
    set({ manualQueue: [hash, ...get().manualQueue] })
  },

  // "Add to Queue" — appended after whatever's already manually queued, still ahead of
  // the natural upcoming queue.
  appendToQueue: (hash) => {
    set({ manualQueue: [...get().manualQueue, hash] })
  },

  removeFromManualQueue: (index) => {
    set({ manualQueue: get().manualQueue.filter((_, i) => i !== index) })
  },

  clearManualQueue: () => set({ manualQueue: [] }),

  refillShuffleQueue: () => {
    const { queueTracks, shuffle, shuffledQueue, shuffleHistory, lookahead, tracks, trackPlayCounts } = get()
    if (queueTracks.length === 0) return

    // Exclude recently played tracks; if history has consumed everything, start a fresh cycle
    const recentSet = new Set(shuffleHistory.slice(-lookahead))
    let candidates = queueTracks.filter(h => !recentSet.has(h))
    if (candidates.length === 0) candidates = [...queueTracks]

    const count = Math.min(lookahead, candidates.length)
    let picks: string[]

    if (shuffle === ShuffleMode.Weighted) {
      picks = pickWeighted(candidates, trackPlayCounts, count)
    } else if (shuffle === ShuffleMode.Discovery) {
      picks = pickDiscovery(candidates, trackPlayCounts, count)
    } else if (shuffle === ShuffleMode.Favorites) {
      const favorited = new Set(tracks.filter(t => t.favorited).map(t => t.hash))
      picks = pickFavorites(candidates, trackPlayCounts, favorited, count)
    } else if (shuffle === ShuffleMode.Random) {
      picks = fisherYates(candidates)
    } else {
      // Smart: weighted selection without replacement that spreads artists across the queue.
      const hashToArtist = new Map(tracks.map(t => [t.hash, t.artist]))
      const seedRecentArtists = shuffleHistory.slice(-ARTIST_LOOKBEHIND).map(h => hashToArtist.get(h) ?? '')
      picks = pickSmart(candidates, hashToArtist, seedRecentArtists, count)
    }

    set({
      shuffledQueue: [...shuffledQueue, ...picks],
      shuffleHistory: [...shuffleHistory, ...picks].slice(-(lookahead * 2)),
    })
  },
})
