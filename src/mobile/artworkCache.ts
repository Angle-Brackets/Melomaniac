import { invoke } from '@tauri-apps/api/core';

// ── Module-level cache ─────────────────────────────────────────────────────────
// Maps are module-level (not React state) so they survive component unmounts
// and re-renders without triggering additional fetches or subscriptions.
// A module is loaded once per JS context, so the cache lives for the entire
// app session — equivalent to a singleton without needing a global store.
const trackUrlCache    = new Map<string, string>();
const playlistUrlCache = new Map<string, string>();

// ── In-flight deduplication ────────────────────────────────────────────────────
// If the same artwork is requested by multiple callers before the first fetch
// resolves (e.g. MiniPlayer + TrackRow both mount at once), they all receive
// the same Promise object so only one IPC call is made to Rust.
const inFlight = new Map<string, Promise<string | null>>();

// ── Concurrency limiter ────────────────────────────────────────────────────────
// Caps the number of simultaneous Tauri `invoke` calls to avoid saturating the
// IPC bridge on startup when hundreds of tracks are pre-fetched at once.
const MAX_CONCURRENT = 12;
let active = 0;
const queue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => queue.push(() => { active++; resolve(); }));
}

function releaseSlot(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function fetchWithThrottle<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

// ── Subscriber registry ────────────────────────────────────────────────────────
// Hooks (useTrackArtwork / usePlaylistArtwork) use useSyncExternalStore, which
// requires an external subscribe/getSnapshot pair.  When a fetch completes,
// notify() triggers re-renders only in the components subscribed to that key —
// not the whole tree.
type Listener = () => void;
const trackListeners    = new Map<string, Set<Listener>>();
const playlistListeners = new Map<string, Set<Listener>>();

function notify(map: Map<string, Set<Listener>>, key: string) {
  map.get(key)?.forEach(fn => fn());
}

export function subscribeTrackArtwork(trackHash: string, cb: Listener): () => void {
  if (!trackListeners.has(trackHash)) trackListeners.set(trackHash, new Set());
  trackListeners.get(trackHash)!.add(cb);
  return () => trackListeners.get(trackHash)?.delete(cb);
}

export function subscribePlaylistArtwork(key: string, cb: Listener): () => void {
  if (!playlistListeners.has(key)) playlistListeners.set(key, new Set());
  playlistListeners.get(key)!.add(cb);
  return () => playlistListeners.get(key)?.delete(cb);
}

// ── Cache invalidation ─────────────────────────────────────────────────────────
// Called by hooks when artworkVersion bumps so the next getTrackArtwork /
// getPlaylistArtwork call hits Rust instead of returning the stale entry.

export function bustEntry(trackHash: string): void {
  trackUrlCache.delete(trackHash);
  inFlight.delete(trackHash);
}

export function bustPlaylistEntry(playlistId: string, branchName: string = 'main'): void {
  const key = `${playlistId}::${branchName}`;
  playlistUrlCache.delete(key);
  inFlight.delete(key);
}

// ── Synchronous cache reads (used as useSyncExternalStore snapshots)
export function getCachedTrackArtwork(trackHash: string): string | null {
  return trackUrlCache.get(trackHash) || null;
}

export function getCachedPlaylistArtwork(playlistId: string, branchName: string = 'main'): string | null {
  return playlistUrlCache.get(`${playlistId}::${branchName}`) || null;
}

// ── Async fetch ────────────────────────────────────────────────────────────────
// getTrackArtwork / getPlaylistArtwork are idempotent: calling them a second time
// returns the cached value immediately (or the same in-flight Promise if still
// pending).  They are safe to call from render paths, effects, or prefetch loops.
export function getTrackArtwork(trackHash: string, _artworkHash: string): Promise<string | null> {
  const cached = trackUrlCache.get(trackHash);
  if (cached !== undefined) return Promise.resolve(cached || null);

  const existing = inFlight.get(trackHash);
  if (existing) return existing;

  const p = fetchWithThrottle(() =>
    invoke<string>('track_get_artwork', { hash: trackHash })
  ).then(dataUrl => {
    trackUrlCache.set(trackHash, dataUrl);
    inFlight.delete(trackHash);
    notify(trackListeners, trackHash);
    return dataUrl;
  }).catch(() => {
    inFlight.delete(trackHash);
    return null;
  });

  inFlight.set(trackHash, p);
  return p;
}

export function getPlaylistArtwork(playlistId: string, branchName: string = 'main'): Promise<string | null> {
  const key = `${playlistId}::${branchName}`;
  const cached = playlistUrlCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached || null);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = fetchWithThrottle(() =>
    invoke<string>('playlist_get_artwork', { playlistId, branchName })
  ).then(dataUrl => {
    playlistUrlCache.set(key, dataUrl);
    inFlight.delete(key);
    notify(playlistListeners, key);
    return dataUrl;
  }).catch(() => {
    inFlight.delete(key);
    return null;
  });

  inFlight.set(key, p);
  return p;
}
