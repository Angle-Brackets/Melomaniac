import { useState, useEffect } from 'react';
import { getTrackArtwork, getCachedTrackArtwork } from '../artworkCache';

export function useTrackArtwork(trackHash: string, artworkHash: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    trackHash ? getCachedTrackArtwork(trackHash) : null
  );

  useEffect(() => {
    if (!artworkHash || !trackHash) return;
    const cached = getCachedTrackArtwork(trackHash);
    if (cached) { setUrl(cached); return; }
    let cancelled = false;
    getTrackArtwork(trackHash, artworkHash).then(u => {
      if (!cancelled) setUrl(u);
    });
    return () => { cancelled = true; };
  }, [trackHash, artworkHash]);

  return url;
}
