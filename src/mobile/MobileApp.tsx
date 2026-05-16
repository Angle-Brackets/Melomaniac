import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './style.css';
import { applyTheme } from '../shared/themes';
import { useStore } from '../store';
import { positionMsRef, loopStateRef } from './playerContext';
import { getTrackArtwork, getPlaylistArtwork } from './artworkCache';
import { NowPlaying } from './components/NowPlaying';
import { Library, PlaylistsList } from './components/Library';
import { PlaylistDetail } from './components/PlaylistDetail';
import { Discover } from './components/Discover';
import { Settings } from './components/Settings';
import type { TabId } from './components/common';

export default function MobileApp() {
  const [tab, setTab] = useState<TabId>('now');
  const [playlistDetailOpen, setPlaylistDetailOpen] = useState(false);

  const loadLibrary   = useStore(s => s.loadLibrary);
  const loadPlaylists = useStore(s => s.loadPlaylists);

  useEffect(() => {
    applyTheme('warm');
    // Load library then eagerly prefetch all track artwork into the cache.
    // By the time the user sees Library or NowPlaying the images are ready.
    loadLibrary().then(() => {
      const { tracks } = useStore.getState();
      tracks.forEach(t => { if (t.artwork_hash) getTrackArtwork(t.hash, t.artwork_hash); });
    });
    // Restore last-selected playlist after playlists load and pre-populate the queue
    loadPlaylists().then(() => {
      const saved = localStorage.getItem('mm_last_playlist');
      if (!saved) return;
      const { playlists, setCurrentPlaylist, loadQueue } = useStore.getState();
      const pl = playlists.find(p => p.id === saved);
      if (!pl) return;
      setCurrentPlaylist(saved);
      const branchName = pl.branches.find(b => b.name === 'main')?.name ?? pl.branches[0]?.name ?? 'main';
      invoke<{ hash: string }[]>('playlist_get_tracks', { playlistId: saved, branchName })
        .then(ptracks => { loadQueue(ptracks.map(t => t.hash)); })
        .catch(() => {});
      // Prefetch playlist artworks
      playlists.forEach(p => getPlaylistArtwork(p.id));
    });
  }, []);

  // Persist playlist selection so it survives app restarts
  useEffect(() => {
    return useStore.subscribe(state => {
      const id = state.currentPlaylistId;
      if (id) localStorage.setItem('mm_last_playlist', id);
    });
  }, []);

  // Lives outside NowPlaying so it stays active when the user switches tabs
  useEffect(() => {
    type AudioPayload =
      | 'TrackEnded' | 'RemotePlay' | 'RemotePause'
      | 'RemoteNextTrack' | 'RemotePreviousTrack' | 'RemoteTogglePlayPause'
      | { PositionChanged: number }
      | { DurationKnown: number }
      | { Error: string };

    const playNext = () => {
      const s = useStore.getState();
      s.advance();
      const hash = useStore.getState().currentHash();
      if (!hash) { s.setPlaying(false); return; }
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (!track) { s.setPlaying(false); return; }
      s.setLoaded(track.hash, track.duration_ms);
      positionMsRef.current = 0;
      invoke('track_play', { hash: track.hash }).catch(console.error);
      s.setPlaying(true);
    };

    const playPrev = () => {
      const s = useStore.getState();
      s.retreat();
      const hash = useStore.getState().currentHash();
      if (!hash) return;
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (!track) return;
      s.setLoaded(track.hash, track.duration_ms);
      positionMsRef.current = 0;
      invoke('track_play', { hash: track.hash }).catch(console.error);
      s.setPlaying(true);
    };

    let unlisten: (() => void) | undefined;
    listen<AudioPayload>('audio://event', ({ payload }) => {
      if (typeof payload === 'object' && 'PositionChanged' in payload) {
        const posMs = payload.PositionChanged;
        const { loopMode: lm, abA: a, abB: b, durMs: dur } = loopStateRef;
        if (lm === 'ab' && dur > 0 && posMs >= b * dur) {
          const aMs = Math.round(a * dur);
          positionMsRef.current = aMs;
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          return;
        }
        positionMsRef.current = posMs;
        return;
      }
      if (typeof payload === 'object' && 'DurationKnown' in payload) {
        if (payload.DurationKnown > 0) {
          loopStateRef.durMs = payload.DurationKnown;
          const { loadedTrackHash, setLoaded } = useStore.getState();
          if (loadedTrackHash) setLoaded(loadedTrackHash, payload.DurationKnown);
        }
        return;
      }
      if (payload === 'TrackEnded') {
        positionMsRef.current = 0;
        const { loopMode: lm, abA: a, durMs: dur } = loopStateRef;
        if (lm === 'one') {
          const s = useStore.getState();
          const hash = s.currentHash();
          if (hash) invoke('track_play', { hash }).catch(console.error);
          s.setPlaying(true);
          return;
        }
        if (lm === 'ab') {
          const aMs = Math.round(a * dur);
          positionMsRef.current = aMs;
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          invoke('audio_play').catch(console.error);
          useStore.getState().setPlaying(true);
          return;
        }
        playNext();
        return;
      }
      if (payload === 'RemotePlay')  { useStore.getState().setPlaying(true); return; }
      if (payload === 'RemotePause') { useStore.getState().setPlaying(false); return; }
      if (payload === 'RemoteTogglePlayPause') {
        const s = useStore.getState();
        s.setPlaying(!s.isPlaying);
        return;
      }
      if (payload === 'RemoteNextTrack')     { playNext(); return; }
      if (payload === 'RemotePreviousTrack') { playPrev(); return; }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTab = (id: TabId) => {
    setPlaylistDetailOpen(false);
    setTab(id);
  };

  const handlePlaylistDetail = () => setPlaylistDetailOpen(true);
  const handlePlaylistBack   = () => setPlaylistDetailOpen(false);

  // Thin drag region at the very top so the undecorated window is moveable on desktop.
  // Has no visual presence and is a no-op on real mobile.
  const dragStrip = (
    <div
      data-tauri-drag-region
      style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 16, zIndex: 9999 }}
    />
  );

  if (playlistDetailOpen) {
    return (
      <div className="mobile-root">
        {dragStrip}
        <PlaylistDetail onBack={handlePlaylistBack} onTab={handleTab}/>
      </div>
    );
  }

  return (
    <div className="mobile-root">
      {dragStrip}
      {tab === 'library'   && <Library onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
      {tab === 'playlists' && <PlaylistsList onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
      {tab === 'now'       && <NowPlaying onTab={handleTab}/>}
      {tab === 'discover'  && <Discover onTab={handleTab}/>}
      {tab === 'settings'  && <Settings onTab={handleTab}/>}
    </div>
  );
}
