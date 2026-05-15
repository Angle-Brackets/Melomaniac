import { useSyncExternalStore, useEffect } from 'react';
import { getTrackArtwork, getCachedTrackArtwork, subscribeTrackArtwork } from '../artworkCache';

export function useTrackArtwork(trackHash: string, artworkHash: string | null): string | null {
  const url = useSyncExternalStore(
    (cb) => trackHash ? subscribeTrackArtwork(trackHash, cb) : () => {},
    ()   => trackHash ? getCachedTrackArtwork(trackHash) : null,
    ()   => null,
  );

  useEffect(() => {
    if (!artworkHash || !trackHash) return;
    getTrackArtwork(trackHash, artworkHash);
  }, [trackHash, artworkHash]);

  return url;
}
