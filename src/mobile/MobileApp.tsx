import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './style.css';
import { applyTheme, writeCustomHue } from '../shared/themes';
import { useStore } from '../store';
import { ShuffleMode } from '../store/types';
import { positionMsRef, loopStateRef } from './playerContext';
import { getTrackArtwork, getPlaylistArtwork } from './artworkCache';
import { NowPlaying } from './components/NowPlaying';
import { Library, PlaylistsList } from './components/Library';
import { PlaylistDetail } from './components/PlaylistDetail';
import { Discover } from './components/Discover';
import { Settings } from './components/Settings';
import { DiffViewer } from '../components/DiffViewer';
import { PairingModal } from '../components/PairingModal';
import type { TabId } from './components/common';

// TAB_ORDER defines the spatial layout used to derive slide direction.
const TAB_ORDER: TabId[] = ['library', 'playlists', 'now', 'discover', 'settings'];

type MobileSavedPlaybackState = {
  hash: string; durationMs: number;
  playlistId: string | null; branchName: string | null;
  shuffle: ShuffleMode;
  shuffledQueue?: string[];
  shuffleIndex?: number;
  positionMs?: number;
  loopMode?: 'off' | 'one' | 'ab';
};

export default function MobileApp() {
  const [tab, setTab] = useState<TabId>('now');
  // tabKey is incremented on every tab switch to force a remount, which re-triggers the CSS slide-in animation.
  const [tabKey,  setTabKey]  = useState(0);
  // tabDir drives which animation variant plays — tabs to the right of the current one slide in from the right.
  const [tabDir,  setTabDir]  = useState<'right' | 'left'>('right');

  // Detail overlay — kept mounted during exit animation so it can slide out
  const [detailMounted, setDetailMounted] = useState(false);
  const [detailActive,  setDetailActive]  = useState(false);
  const detailActiveRef = useRef(false);

  const loadLibrary          = useStore(s => s.loadLibrary);
  const loadPlaylists        = useStore(s => s.loadPlaylists);
  const syncToast            = useStore(s => s.syncToast);
  const setDownloadProgress  = useStore(s => s.setDownloadProgress);
  const refreshLivePeers     = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices  = useStore(s => s.refreshKnownDevices);

  useEffect(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('melomaniac.settings') ?? '{}'); } catch { return {}; } })();
    const theme = saved.theme ?? 'warm';
    if (theme === 'custom') { writeCustomHue(saved.customAccentHue ?? saved.accentHue ?? 28); applyTheme('custom'); }
    else { applyTheme(theme); }
    // Load library then eagerly prefetch all track artwork into the cache.
    loadLibrary().then(() => {
      const { tracks } = useStore.getState();
      tracks.forEach(t => { if (t.artwork_hash) getTrackArtwork(t.hash, t.artwork_hash); });
    });

    // Check if audio is still running from a previous session (e.g. after a WebView restart).
    // audio_position resolving means the bridge still has a track loaded — pair with saved state.
    const savedPlayback = (() => {
      try {
        const raw = localStorage.getItem('melomaniac.playback_state');
        return raw ? JSON.parse(raw) as MobileSavedPlaybackState : null;
      } catch { return null; }
    })();
    const audioCheckPromise: Promise<MobileSavedPlaybackState | null> = savedPlayback
      ? invoke<number>('audio_position')
          .then(() => savedPlayback)
          .catch(() => { localStorage.removeItem('melomaniac.playback_state'); return null; })
      : Promise.resolve(null);

    // Restore last-selected playlist and queue, then apply playback restore if needed.
    Promise.all([loadPlaylists(), audioCheckPromise]).then(([, restore]) => {
      const { playlists, setCurrentPlaylist, setPlayingBranch, loadQueue, branchByPlaylist } = useStore.getState();
      if (!playlists.length) return;
      const savedPl = localStorage.getItem('mm_last_playlist');
      const targetId = (savedPl && playlists.find(p => p.id === savedPl)) ? savedPl : playlists[0].id;
      const pl = playlists.find(p => p.id === targetId)!;
      setCurrentPlaylist(targetId);
      const branchName = useStore.getState().currentBranchName;
      const validBranch = pl.branches.find(b => b.name === branchName)?.name ?? pl.branches.find(b => b.name === 'main')?.name ?? pl.branches[0]?.name ?? 'main';
      setPlayingBranch(validBranch);
      invoke<import('../store/types').PlaylistTrackRecord[]>('playlist_get_tracks', { playlistId: targetId, branchName: validBranch })
        .then(ptracks => {
          loadQueue(ptracks.map(t => t.hash));
          useStore.getState().hydrateTracksFromPlaylist(ptracks);
          if (restore && restore.playlistId === targetId && restore.branchName === validBranch) {
            const track = ptracks.find(t => t.hash === restore.hash);
            if (track) {
              const s = useStore.getState();
              s.setLoaded(restore.hash, restore.durationMs);
              s.setPlaying(true);
              if (restore.shuffle !== ShuffleMode.Off) {
                s.setShuffle(restore.shuffle); // sets mode + refills queue
                if (restore.shuffledQueue?.length && restore.shuffleIndex != null) {
                  const validSet = new Set(ptracks.map(t => t.hash));
                  const filtered = restore.shuffledQueue.filter(h => validSet.has(h));
                  if (filtered.length > 0) {
                    useStore.setState({ shuffledQueue: filtered, shuffleIndex: restore.shuffleIndex });
                  }
                }
              } else {
                const idx = ptracks.findIndex(t => t.hash === restore.hash);
                if (idx >= 0) s.jumpTo(idx);
              }
              if (restore.loopMode && restore.loopMode !== 'off') {
                loopStateRef.loopMode = restore.loopMode;
              }
              if (restore.positionMs && restore.positionMs > 0) {
                invoke('audio_seek', { positionMs: restore.positionMs }).catch(console.error);
              }
            }
          }
        })
        .catch(() => {});
      playlists.forEach(p => getPlaylistArtwork(p.id, branchByPlaylist[p.id] ?? 'main'));
    });
  }, []);

  // Persist playlist selection so it survives app restarts
  useEffect(() => {
    return useStore.subscribe(state => {
      const id = state.currentPlaylistId;
      if (id) localStorage.setItem('mm_last_playlist', id);
    });
  }, []);

  // Persist playback state for WebView-restart recovery
  useEffect(() => {
    return useStore.subscribe(state => {
      if (state.loadedTrackHash) {
        localStorage.setItem('melomaniac.playback_state', JSON.stringify({
          hash: state.loadedTrackHash,
          durationMs: state.duration_ms,
          playlistId: state.currentPlaylistId,
          branchName: state.playingBranchName,
          shuffle: state.shuffle,
          shuffledQueue: state.shuffle !== ShuffleMode.Off ? state.shuffledQueue : undefined,
          shuffleIndex: state.shuffle !== ShuffleMode.Off ? state.shuffleIndex : undefined,
        } satisfies MobileSavedPlaybackState));
      } else {
        localStorage.removeItem('melomaniac.playback_state');
      }
    });
  }, []);

  // Patch position and loop mode into the saved state periodically and when the
  // app is backgrounded — these change without going through the Zustand store.
  useEffect(() => {
    const patch = () => {
      const raw = localStorage.getItem('melomaniac.playback_state');
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        s.positionMs = positionMsRef.current;
        s.loopMode   = loopStateRef.loopMode;
        localStorage.setItem('melomaniac.playback_state', JSON.stringify(s));
      } catch {}
    };
    const id = setInterval(patch, 10_000);
    const onHide = () => patch();
    const onVisibility = () => { if (document.visibilityState === 'hidden') patch(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ── Keep lock-screen like button in sync with favorites ──────────────────────
  useEffect(() => {
    let prevHash: string | null = null;
    let prevFavorited: boolean | undefined;
    return useStore.subscribe(state => {
      const hash = state.loadedTrackHash;
      const favorited = hash ? (state.tracks.find(t => t.hash === hash)?.favorited ?? false) : false;
      if (hash !== prevHash || favorited !== prevFavorited) {
        if (hash) invoke('audio_set_like_state', { isActive: favorited }).catch(() => {});
        prevHash = hash;
        prevFavorited = favorited;
      }
    });
  }, []);

  // ── Keep lock-screen shuffle button in sync with in-app shuffle state ────────
  useEffect(() => {
    let prevShuffle: ShuffleMode | undefined;
    return useStore.subscribe(state => {
      if (state.shuffle !== prevShuffle) {
        const mode = state.shuffle === ShuffleMode.Random ? 1 : state.shuffle === ShuffleMode.Smart ? 2 : 0;
        invoke('audio_set_shuffle_state', { mode }).catch(() => {});
        prevShuffle = state.shuffle;
      }
    });
  }, []);

  // ── Background peer poll — drives auto-sync when a known device comes online ──
  useEffect(() => {
    refreshLivePeers()
    refreshKnownDevices()
    // Second poll after 4 s catches mDNS re-discovery lag after app resume —
    // NWBrowser can take a few seconds to re-find peers on the local network.
    const earlyId = setTimeout(refreshLivePeers, 4_000)
    const id = setInterval(refreshLivePeers, 15_000)
    return () => { clearTimeout(earlyId); clearInterval(id) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync progress listener ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    listen<{ playlist_id: string; done: number; total: number }>('sync://progress', ({ payload }) => {
      const pct = payload.total > 0 ? payload.done / payload.total : 0
      setDownloadProgress(payload.playlist_id, pct)
    }).then(fn => { if (cancelled) fn(); else unlisten = fn })
    return () => { cancelled = true; unlisten?.() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Global audio event listener ───────────────────────────────────────────────
  // Lives outside NowPlaying so it stays active when the user switches tabs
  useEffect(() => {
    type AudioPayload =
      | 'TrackEnded' | 'RemotePlay' | 'RemotePause'
      | 'RemoteNextTrack' | 'RemotePreviousTrack' | 'RemoteTogglePlayPause'
      | 'RemoteLike'
      | { RemoteShuffleChange: number }
      | { PositionChanged: number }
      | { DurationKnown: number }
      | { RemoteSeek: number }
      | { Error: string };

    // ── playNext / playPrev ────────────────────────────────────────────────────
    let lastAdvancedAt = 0;
    // Reset per track so each track gets at most one play record.
    let hasRecordedPlay = false;

    const playNext = (recordSkip = false) => {
      const now = Date.now();
      // 1500 ms debounce guards against double-fire when TrackEnded and RemoteNextTrack
      // arrive nearly simultaneously (e.g. OS media key pressed right as a track ends).
      if (now - lastAdvancedAt < 1500) return;
      lastAdvancedAt = now;
      const s = useStore.getState();
      if (recordSkip) {
        const lh = s.loadedTrackHash;
        if (lh) invoke('track_record_skip', { hash: lh, positionMs: positionMsRef.current }).catch(console.error);
      }
      s.advance();
      const hash = useStore.getState().currentHash();
      if (!hash) { s.setPlaying(false); return; }
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (!track) { s.setPlaying(false); return; }
      s.setLoaded(track.hash, track.duration_ms);
      positionMsRef.current = 0;
      hasRecordedPlay = false;
      invoke('track_play', { hash: track.hash }).catch(console.error);
      s.setPlaying(true);
    };

    const playPrev = () => {
      const s = useStore.getState();
      // Only record a skip when going back — if >3 s in the track restarts, not a skip
      if (positionMsRef.current <= 3000) {
        const lh = s.loadedTrackHash;
        if (lh) invoke('track_record_skip', { hash: lh, positionMs: positionMsRef.current }).catch(console.error);
      }
      s.retreat();
      const hash = useStore.getState().currentHash();
      if (!hash) return;
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (!track) return;
      s.setLoaded(track.hash, track.duration_ms);
      positionMsRef.current = 0;
      hasRecordedPlay = false;
      invoke('track_play', { hash: track.hash }).catch(console.error);
      s.setPlaying(true);
    };

    // ── Tauri listener registration ────────────────────────────────────────────
    // React 18 Strict Mode mounts effects twice in dev to detect side-effects.
    // `listen()` returns a Promise, so its resolution can race with the cleanup
    // function — if the component unmounts before the promise resolves, `unlisten`
    // is never set and the listener becomes a zombie.  The `cancelled` flag lets
    // the `.then()` callback immediately call the unsubscribe handle instead.
    let cancelled = false;
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
        // Record a play once the listener crosses 50% of the track or 4 minutes.
        if (!hasRecordedPlay) {
          const dur = loopStateRef.durMs;
          const lh  = useStore.getState().loadedTrackHash;
          if (lh && dur > 0 && posMs >= Math.min(dur * 0.5, 240_000)) {
            hasRecordedPlay = true;
            invoke('track_record_play', { hash: lh, durationMs: posMs }).catch(console.error);
          }
        }
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
          useStore.getState().resumeAudio().catch(console.error);
          return;
        }
        playNext();
        return;
      }
      if (payload === 'RemotePlay')            { useStore.getState().resumeAudio().catch(console.error); return; }
      if (payload === 'RemotePause')           { useStore.getState().pauseAudio().catch(console.error);  return; }
      if (payload === 'RemoteTogglePlayPause') { useStore.getState().toggleAudio().catch(console.error); return; }
      if (payload === 'RemoteNextTrack')     { playNext(true); return; }
      if (payload === 'RemotePreviousTrack') { playPrev(); return; }
      if (typeof payload === 'object' && 'RemoteShuffleChange' in payload) {
        const mode = payload.RemoteShuffleChange;
        const shuffleMode = mode === 1 ? ShuffleMode.Random : mode === 2 ? ShuffleMode.Smart : ShuffleMode.Off;
        useStore.getState().setShuffle(shuffleMode);
        invoke('audio_set_shuffle_state', { mode }).catch(console.error);
        return;
      }
      if (payload === 'RemoteLike') {
        const s = useStore.getState();
        const hash = s.loadedTrackHash;
        if (!hash) return;
        // Compute new state before toggling so we don't need to re-read the store
        const nowFavorited = !(s.tracks.find(t => t.hash === hash)?.favorited ?? false);
        s.toggleFavorite(hash);
        invoke('audio_set_like_state', { isActive: nowFavorited }).catch(console.error);
        return;
      }
      if (typeof payload === 'object' && 'RemoteSeek' in payload) {
        const posMs = payload.RemoteSeek;
        positionMsRef.current = posMs;
        invoke('audio_seek', { positionMs: posMs }).catch(console.error);
        return;
      }
    }).then(fn => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const handleTab = (id: TabId) => {
    const oldIdx = TAB_ORDER.indexOf(tab);
    const newIdx = TAB_ORDER.indexOf(id);
    // Slide direction mirrors the logical left-to-right order of TAB_ORDER.
    setTabDir(newIdx >= oldIdx ? 'right' : 'left');
    setTabKey(k => k + 1);
    setTab(id);
    // Close detail without animation when switching tabs
    detailActiveRef.current = false;
    setDetailActive(false);
    setDetailMounted(false);
  };

  const handlePlaylistDetail = () => {
    setDetailMounted(true);
    // Double rAF ensures the element is painted before the transition starts
    requestAnimationFrame(() => requestAnimationFrame(() => {
      detailActiveRef.current = true;
      setDetailActive(true);
    }));
    // Push history state so Android back / browser back triggers closeDetail
    window.history.pushState({ mm: 'detail' }, '');
  };

  const handlePlaylistBack = () => {
    detailActiveRef.current = false;
    setDetailActive(false);
    setTimeout(() => setDetailMounted(false), 360);
  };

  // ── Android / browser back button ─────────────────────────────────────────
  // Android hardware back button & browser back gesture via History API
  useEffect(() => {
    const onPop = () => {
      if (detailActiveRef.current) {
        window.history.pushState({ mm: 'detail' }, ''); // repush so next back still works
        handlePlaylistBack();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── iOS left-edge swipe gesture ───────────────────────────────────────────
  // iOS-style left-edge swipe to go back
  useEffect(() => {
    let startX = 0, startY = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      // startX < 28: touch must originate in the left-edge bezel zone (≈1 thumb-width).
      // dy < 100: reject diagonal or vertical swipes so normal scrolling is unaffected.
      if (startX < 28 && dx > 60 && dy < 100 && detailActiveRef.current) handlePlaylistBack();
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend',   onEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thin drag region at the very top so the undecorated window is moveable on desktop.
  // Has no visual presence and is a no-op on real mobile.
  const dragStrip = (
    <div
      data-tauri-drag-region
      style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 16, zIndex: 9999 }}
    />
  );

  return (
    <div className="mobile-root">
      {dragStrip}

      {/* Tab content — key forces remount on tab change, triggering the slide animation */}
      {/* When the detail overlay is open, the tab content scales down and slides left
          (iOS-style push transition) — the detail panel covers the remaining right portion. */}
      <div
        key={tabKey}
        style={{
          position: 'absolute', inset: 0,
          transform: detailActive ? 'translateX(-28%) scale(0.96)' : 'translateX(0) scale(1)',
          transition: 'transform 0.36s cubic-bezier(0.22,1,0.36,1)',
          transformOrigin: 'left center',
          animation: `${tabDir === 'right' ? 'mmSlideInRight' : 'mmSlideInLeft'} 0.3s cubic-bezier(0.22,1,0.36,1) both`,
          willChange: 'transform',
        }}
      >
        {tab === 'library'   && <Library onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
        {tab === 'playlists' && <PlaylistsList onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
        {tab === 'now'       && <NowPlaying onTab={handleTab}/>}
        {tab === 'discover'  && <Discover onTab={handleTab}/>}
        {tab === 'settings'  && <Settings onTab={handleTab}/>}
      </div>

      {/* Playlist detail — slides over the tab content from the right */}
      {detailMounted && (
        <div style={{
          position: 'absolute', inset: 0,
          transform: detailActive ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.36s cubic-bezier(0.22,1,0.36,1)',
          willChange: 'transform',
          boxShadow: detailActive ? '-12px 0 40px rgba(0,0,0,0.45)' : 'none',
        }}>
          <PlaylistDetail onBack={handlePlaylistBack} onTab={handleTab}/>
        </div>
      )}

      <DiffViewer platform="mobile" />
      <PairingModal platform="mobile" />

      {syncToast && (
        <div style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom) + 80px)',
          left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-1)', border: '1px solid var(--border-2)',
          borderRadius: 20, padding: '8px 18px',
          fontSize: 13, color: 'var(--accent-light)',
          fontFamily: 'system-ui, sans-serif', fontWeight: 500,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          pointerEvents: 'none', zIndex: 200,
          whiteSpace: 'nowrap',
        }}>{syncToast}</div>
      )}
    </div>
  );
}
