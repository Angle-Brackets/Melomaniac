import { useSyncExternalStore, useEffect } from 'react';
import { getPlaylistArtwork, getCachedPlaylistArtwork, subscribePlaylistArtwork } from '../artworkCache';

export function usePlaylistArtwork(playlistId: string | null, branchName: string = 'main'): string | null {
  const key = playlistId ? `${playlistId}::${branchName}` : '';

  const url = useSyncExternalStore(
    (cb) => key ? subscribePlaylistArtwork(key, cb) : () => {},
    ()   => key ? getCachedPlaylistArtwork(playlistId!, branchName) : null,
    ()   => null,
  );

  useEffect(() => {
    if (!playlistId) return;
    getPlaylistArtwork(playlistId, branchName);
  }, [playlistId, branchName]);

  return url;
}
