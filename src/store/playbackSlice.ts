import { StateCreator } from 'zustand'

export type PlaybackSlice = {
  isPlaying: boolean
  loadedTrackHash: string | null
  duration_ms: number
  volume: number // 0–1, clamped on write

  // position_ms is intentionally absent: it changes at ~60fps and lives in a useRef fed by the
  // audio://event listener. Putting it here would re-render the entire component tree on every tick.

  setPlaying: (v: boolean) => void
  setLoaded: (hash: string | null, duration_ms: number) => void
  setVolume: (v: number) => void
}

export const createPlaybackSlice: StateCreator<PlaybackSlice> = (set) => ({
  isPlaying: false,
  loadedTrackHash: null,
  duration_ms: 0,
  volume: 1,

  setPlaying: (v) => set({ isPlaying: v }),
  setLoaded: (hash, duration_ms) => set({ loadedTrackHash: hash, duration_ms }),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
})
