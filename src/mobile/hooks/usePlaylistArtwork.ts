import { useSyncExternalStore, useEffect } from 'react';
import { useStore } from '../../store';
import { getPlaylistArtwork, getCachedPlaylistArtwork, subscribePlaylistArtwork, bustPlaylistEntry } from '../artworkCache';

export function usePlaylistArtwork(playlistId: string | null, branchName: string = 'main'): string | null {
  const artworkVersion = useStore(s => s.artworkVersion);
  const key = playlistId ? `${playlistId}::${branchName}` : '';

  const url = useSyncExternalStore(
    (cb) => key ? subscribePlaylistArtwork(key, cb) : () => {},
    ()   => key ? getCachedPlaylistArtwork(playlistId!, branchName) : null,
    ()   => null,
  );

  useEffect(() => {
    if (!playlistId) return;
    if (artworkVersion > 0) bustPlaylistEntry(playlistId, branchName);
    getPlaylistArtwork(playlistId, branchName);
  }, [playlistId, branchName, artworkVersion]);

  return url;
}
