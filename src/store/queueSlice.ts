import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { RepeatMode, ShuffleMode } from './types'
import type { TrackStats } from './types'
import type { StoreState } from './index'

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
  trackPlayCounts: Map<string, number> // hash → play_count; populated on demand for Weighted/Discovery

  // Selector: encapsulates the shuffle/linear branch so callers don't duplicate it
  currentHash: () => string | null
  loadQueue: (hashes: string[]) => void
  advance: () => void
  retreat: () => void // shifts index only — does not pop shuffleHistory
  jumpTo: (index: number) => void
  setShuffle: (mode: ShuffleMode) => void
  setRepeat: (mode: RepeatMode) => void
  refillShuffleQueue: () => void
  removeUpcomingTrack: (hash: string) => void
}

// How many recent artists to consider when penalising same-artist picks
const ARTIST_LOOKBEHIND = 4
// Weight multiplier per additional occurrence of the same artist in the lookbehind window.
// 0.25^1 = 25% weight (75% penalty), 0.25^2 = 6.25% weight (94% penalty), etc.
const ARTIST_PENALTY = 0.25

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

  setShuffle: async (mode) => {
    const playing = get().currentHash()
    set({ shuffle: mode, shuffledQueue: [], shuffleHistory: [], shuffleIndex: 0 })
    if (mode === ShuffleMode.Weighted || mode === ShuffleMode.Discovery) {
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
    const { shuffle, shuffledQueue, shuffleIndex, queueTracks, currentIndex } = get()
    if (shuffle !== ShuffleMode.Off) {
      const before = shuffledQueue.slice(0, shuffleIndex + 1)
      const after  = shuffledQueue.slice(shuffleIndex + 1).filter(h => h !== hash)
      set({ shuffledQueue: [...before, ...after] })
    } else {
      const before = queueTracks.slice(0, currentIndex + 1)
      const after  = queueTracks.slice(currentIndex + 1).filter(h => h !== hash)
      set({ queueTracks: [...before, ...after] })
    }
  },

  refillShuffleQueue: () => {
    const { queueTracks, shuffle, shuffledQueue, shuffleHistory, lookahead, tracks, trackPlayCounts } = get()
    if (queueTracks.length === 0) return

    // Exclude recently played tracks; if history has consumed everything, start a fresh cycle
    const recentSet = new Set(shuffleHistory.slice(-lookahead))
    let candidates = queueTracks.filter(h => !recentSet.has(h))
    if (candidates.length === 0) candidates = [...queueTracks]

    let picks: string[]

    if (shuffle === ShuffleMode.Weighted) {
      // weight = 1 / (play_count + 1): unheard tracks get weight 1, heard once get 0.5, etc.
      const pool = [...candidates]
      picks = []
      const count = Math.min(lookahead, pool.length)
      for (let i = 0; i < count; i++) {
        const weights = pool.map(h => 1 / ((trackPlayCounts.get(h) ?? 0) + 1))
        const total = weights.reduce((s, w) => s + w, 0)
        let r = Math.random() * total
        let idx = pool.length - 1
        for (let j = 0; j < pool.length; j++) { r -= weights[j]; if (r <= 0) { idx = j; break } }
        picks.push(pool[idx])
        pool.splice(idx, 1)
      }
    } else if (shuffle === ShuffleMode.Discovery) {
      // Tier candidates by play count; pick from the lowest-play tier first.
      const minPlays = Math.min(...candidates.map(h => trackPlayCounts.get(h) ?? 0))
      const tier = candidates.filter(h => (trackPlayCounts.get(h) ?? 0) === minPlays)
      const pool = tier.length >= Math.min(lookahead, candidates.length) ? tier : candidates
      picks = [...pool]
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[picks[i], picks[j]] = [picks[j], picks[i]]
      }
      picks = picks.slice(0, lookahead)
    } else if (shuffle === ShuffleMode.Random) {
      // Fisher-Yates: uniform random permutation, no repeats within a full cycle
      picks = [...candidates]
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[picks[i], picks[j]] = [picks[j], picks[i]]
      }
    } else {
      // Smart: weighted selection without replacement that spreads artists across the queue.
      // Each candidate's weight is penalised by how recently its artist was heard.
      // weight = ARTIST_PENALTY ^ (# times artist appears in lookbehind window)
      // e.g. heard once → ×0.25, twice → ×0.0625 — same-artist back-to-back is very unlikely.
      const hashToArtist = new Map(tracks.map(t => [t.hash, t.artist]))

      type Candidate = { hash: string; artist: string }
      const pool: Candidate[] = candidates.map(h => ({
        hash: h,
        artist: hashToArtist.get(h) ?? '',
      }))

      // Seed context with the tail of history so the first pick respects what was just heard
      const recentArtists = shuffleHistory
        .slice(-ARTIST_LOOKBEHIND)
        .map(h => hashToArtist.get(h) ?? '')

      picks = []
      const count = Math.min(lookahead, pool.length)

      for (let i = 0; i < count; i++) {
        const freq = new Map<string, number>()
        for (const a of recentArtists.slice(-ARTIST_LOOKBEHIND)) {
          freq.set(a, (freq.get(a) ?? 0) + 1)
        }

        const weights = pool.map(c => Math.pow(ARTIST_PENALTY, freq.get(c.artist) ?? 0))
        const total   = weights.reduce((s, w) => s + w, 0)

        let r = Math.random() * total
        let idx = pool.length - 1
        for (let j = 0; j < pool.length; j++) {
          r -= weights[j]
          if (r <= 0) { idx = j; break }
        }

        picks.push(pool[idx].hash)
        recentArtists.push(pool[idx].artist)
        pool.splice(idx, 1)
      }
    }

    set({
      shuffledQueue: [...shuffledQueue, ...picks],
      shuffleHistory: [...shuffleHistory, ...picks].slice(-(lookahead * 2)),
    })
  },
})
