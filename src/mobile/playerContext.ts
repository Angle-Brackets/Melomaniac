// Module-level playback position ref.
// Written by MobileApp's audio://event listener; read by rAF loops in
// NowPlaying and MiniPlayer without prop drilling.
export const positionMsRef: { current: number } = { current: 0 };
