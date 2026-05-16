// Module-level playback position ref.
// Written by MobileApp's audio://event listener; read by rAF loops in
// NowPlaying and MiniPlayer without prop drilling.
export const positionMsRef: { current: number } = { current: 0 };

export const loopStateRef: {
  loopMode: 'off' | 'one' | 'ab';
  abA: number;
  abB: number;
  durMs: number;
} = { loopMode: 'off', abA: 0, abB: 1, durMs: 0 };
