import { useSyncExternalStore, useEffect } from 'react';
import { useStore } from '../../store';
import { getTrackArtwork, getCachedTrackArtwork, subscribeTrackArtwork, bustEntry } from '../artworkCache';

export function useTrackArtwork(trackHash: string, artworkHash: string | null): string | null {
  const artworkVersion = useStore(s => s.artworkVersion);

  const url = useSyncExternalStore(
    (cb) => trackHash ? subscribeTrackArtwork(trackHash, cb) : () => {},
    ()   => trackHash ? getCachedTrackArtwork(trackHash) : null,
    ()   => null,
  );

  useEffect(() => {
    if (!artworkHash || !trackHash) return;
    if (artworkVersion > 0) bustEntry(trackHash);
    getTrackArtwork(trackHash, artworkHash);
  }, [trackHash, artworkHash, artworkVersion]);

  return url;
}
