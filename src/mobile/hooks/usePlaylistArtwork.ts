import { useState, useEffect } from 'react';
import { getPlaylistArtwork, getCachedPlaylistArtwork } from '../artworkCache';

export function usePlaylistArtwork(playlistId: string | null, branchName: string = 'main'): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    playlistId ? getCachedPlaylistArtwork(playlistId, branchName) : null
  );

  useEffect(() => {
    if (!playlistId) return;
    const cached = getCachedPlaylistArtwork(playlistId, branchName);
    if (cached) { setUrl(cached); return; }
    let cancelled = false;
    getPlaylistArtwork(playlistId, branchName).then(u => {
      if (!cancelled) setUrl(u);
    });
    return () => { cancelled = true; };
  }, [playlistId, branchName]);

  return url;
}
