import { invoke } from '@tauri-apps/api/core';

// Shared module-level caches — survive component remounts and re-renders.
const trackUrlCache    = new Map<string, string>();
const playlistUrlCache = new Map<string, string>();

// In-flight promise dedup — prevents N concurrent fetches for the same key.
const inFlight = new Map<string, Promise<string | null>>();

// Concurrency limiter — at most MAX_CONCURRENT IPC calls in flight at once.
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

export function getCachedTrackArtwork(trackHash: string): string | null {
  const v = trackUrlCache.get(trackHash);
  return v || null;
}

export function getCachedPlaylistArtwork(playlistId: string, branchName: string = 'main'): string | null {
  const v = playlistUrlCache.get(`${playlistId}::${branchName}`);
  return v || null;
}

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
    return dataUrl;
  }).catch(() => {
    inFlight.delete(trackHash); // remove from in-flight so a later mount can retry
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
    return dataUrl;
  }).catch(() => {
    inFlight.delete(key);
    return null;
  });

  inFlight.set(key, p);
  return p;
}
