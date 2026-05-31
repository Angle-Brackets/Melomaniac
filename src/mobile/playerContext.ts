// ── Module-level playback refs ─────────────────────────────────────────────────
// These are plain objects, NOT React state, for a deliberate reason:
// `PositionChanged` events arrive every ~250 ms from Rust.  If positionMsRef were
// React state, every update would schedule a re-render of NowPlaying (and any
// other subscribed component), causing ~4 re-renders per second.  Instead, rAF
// loops in NowPlaying and MiniPlayer read the ref synchronously at 60 fps and
// update only DOM nodes directly (via ref.current.style), keeping React out of
// the hot path entirely.
//
// loopStateRef is co-located here because the audio event handler (MobileApp)
// and NowPlaying both need to read/write loop state without a round-trip through
// React state.  abA / abB are fractions of the track duration (0–1).

// Written by MobileApp's audio://event listener; read by rAF loops in
// NowPlaying and MiniPlayer without prop drilling.
export const positionMsRef: { current: number } = { current: 0 };

export const loopStateRef: {
  loopMode: 'off' | 'one' | 'ab';
  abA: number;   // A-B loop start (fraction of total duration)
  abB: number;   // A-B loop end (fraction of total duration)
  durMs: number; // cached track duration, updated on DurationKnown events
} = { loopMode: 'off', abA: 0, abB: 1, durMs: 0 };
