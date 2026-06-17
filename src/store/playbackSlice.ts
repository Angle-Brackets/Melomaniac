import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

/*
 * Audio control design
 * ──────────────────────────────────────────────────────────────────────────────
 * Playback state has two layers that must stay in sync:
 *   1. The Rust audio bridge (the thing actually making sound).
 *   2. The Zustand isPlaying flag (what the UI renders).
 *
 * resumeAudio / pauseAudio / toggleAudio own BOTH layers atomically.
 * Call these whenever you are resuming or pausing an already-loaded track.
 * State only updates after the invoke resolves, so the UI never lies if the
 * bridge call fails.
 *
 * Why playNext / playPrev are NOT here
 * ─────────────────────────────────────
 * Advancing the queue means choosing which track comes next — that decision
 * depends on shuffle state, manual-queue overrides, loop mode, and which
 * playlist/branch is active. All of that context lives in the component (or
 * in queueSlice which is tightly coupled to it). Pushing that logic down here
 * would either require hoisting the entire queue + playlist state into this
 * slice, or passing a dozen arguments on every call — both worse than the
 * current arrangement.
 *
 * Those paths call invoke('track_play', { hash }) (which loads AND starts
 * playback atomically in Rust) followed by setLoaded + setPlaying(true), so
 * the two-line pattern there is intentional and the coupling is explicit at
 * the call site.
 *
 * setPlaying is kept for backend-driven state changes only:
 *   - AudioEvent::TrackEnded  → setPlaying(false)
 *   - Playback restore on startup (audio was already running in Rust)
 * Components must not call setPlaying directly.
 */

export type PlaybackSlice = {
  isPlaying: boolean
  loadedTrackHash: string | null
  duration_ms: number
  volume: number

  // position_ms is intentionally absent: it changes at ~60fps and lives in a
  // useRef fed by the audio://event listener. Putting it here would re-render
  // the entire component tree on every tick.

  /** Internal — for backend-driven events and startup restore only. */
  setPlaying: (v: boolean) => void
  setLoaded: (hash: string | null, duration_ms: number) => void
  setVolume: (v: number) => void

  /** Resume an already-loaded track. Updates isPlaying only on success. */
  resumeAudio: () => Promise<void>
  /** Pause an already-loaded track. Updates isPlaying only on success. */
  pauseAudio:  () => Promise<void>
  /** Toggle play/pause based on current isPlaying state. */
  toggleAudio: () => Promise<void>
}

export const createPlaybackSlice: StateCreator<PlaybackSlice> = (set, get) => ({
  isPlaying: false,
  loadedTrackHash: null,
  duration_ms: 0,
  volume: 1,

  setPlaying: (v) => set({ isPlaying: v }),
  setLoaded:  (hash, duration_ms) => set({ loadedTrackHash: hash, duration_ms }),
  setVolume:  (v) => set({ volume: Math.max(0, Math.min(1, v)) }),

  resumeAudio: async () => {
    await invoke('audio_play')
    set({ isPlaying: true })
  },

  pauseAudio: async () => {
    await invoke('audio_pause')
    set({ isPlaying: false })
  },

  toggleAudio: async () => {
    if (get().isPlaying) {
      await invoke('audio_pause')
      set({ isPlaying: false })
    } else {
      await invoke('audio_play')
      set({ isPlaying: true })
    }
  },
})
