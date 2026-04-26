import { StateCreator } from 'zustand'
import { RepeatMode, ShuffleMode } from './types'

// Start topping up before the queue fully drains so the UI always has upcoming tracks to display
const REFILL_THRESHOLD = 5

export type QueueSlice = {
  queueTracks: string[]  // hashes in original load order
  currentIndex: number   // position in queueTracks when shuffle is Off
  shuffle: ShuffleMode
  repeat: RepeatMode
  shuffledQueue: string[] // pre-computed upcoming hashes; consumed by both shuffle modes
  shuffleHistory: string[] // recently played hashes used to avoid immediate repeats on refill
  shuffleIndex: number    // current position within shuffledQueue
  lookahead: number       // how many tracks to pre-generate per refill (default 20)

  // Selector: encapsulates the shuffle/linear branch so callers don't duplicate it
  currentHash: () => string | null
  loadQueue: (hashes: string[]) => void
  advance: () => void
  retreat: () => void // shifts index only — does not pop shuffleHistory
  jumpTo: (index: number) => void
  setShuffle: (mode: ShuffleMode) => void
  setRepeat: (mode: RepeatMode) => void
  refillShuffleQueue: () => void
}

export const createQueueSlice: StateCreator<QueueSlice> = (set, get) => ({
  queueTracks: [],
  currentIndex: 0,
  shuffle: ShuffleMode.Off,
  repeat: RepeatMode.None,
  shuffledQueue: [],
  shuffleHistory: [],
  shuffleIndex: 0,
  lookahead: 20,

  currentHash: () => {
    const { queueTracks, currentIndex, shuffle, shuffledQueue, shuffleIndex } = get()
    if (shuffle !== ShuffleMode.Off) return shuffledQueue[shuffleIndex] ?? null
    return queueTracks[currentIndex] ?? null
  },

  loadQueue: (hashes) => {
    set({ queueTracks: hashes, currentIndex: 0, shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0 })
    if (get().shuffle !== ShuffleMode.Off) get().refillShuffleQueue()
  },

  advance: () => {
    const { queueTracks, currentIndex, shuffle, repeat, shuffledQueue, shuffleIndex } = get()

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
    if (shuffle !== ShuffleMode.Off) {
      set({ shuffleIndex: Math.max(0, shuffleIndex - 1) })
    } else {
      set({ currentIndex: Math.max(0, currentIndex - 1) })
    }
  },

  jumpTo: (index) => {
    const { queueTracks } = get()
    if (index >= 0 && index < queueTracks.length) set({ currentIndex: index })
  },

  setShuffle: (mode) => {
    set({ shuffle: mode, shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0 })
    if (mode !== ShuffleMode.Off) get().refillShuffleQueue()
  },

  setRepeat: (mode) => set({ repeat: mode }),

  refillShuffleQueue: () => {
    const { queueTracks, shuffle, shuffledQueue, shuffleHistory, lookahead } = get()
    if (queueTracks.length === 0) return

    // Exclude recently played tracks; if history has consumed everything, start a fresh cycle
    const recentSet = new Set(shuffleHistory.slice(-lookahead))
    let candidates = queueTracks.filter((h) => !recentSet.has(h))
    if (candidates.length === 0) candidates = [...queueTracks]

    let picks: string[]

    if (shuffle === ShuffleMode.Smart) {
      // Fisher-Yates over all candidates guarantees no repeats until the full cycle is exhausted
      picks = [...candidates]
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[picks[i], picks[j]] = [picks[j], picks[i]]
      }
    } else {
      // Random: sample without replacement up to `lookahead` picks, but unbounded across cycles
      const pool = [...candidates]
      picks = []
      const count = Math.min(lookahead, pool.length)
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length)
        picks.push(pool.splice(idx, 1)[0])
      }
    }

    set({
      shuffledQueue: [...shuffledQueue, ...picks],
      // Keep 2× lookahead so the dedup window covers a full refill batch on both sides
      shuffleHistory: [...shuffleHistory, ...picks].slice(-(lookahead * 2)),
    })
  },
})
