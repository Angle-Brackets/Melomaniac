import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './style.css';
import { applyTheme, writeCustomHue } from '../shared/themes';
import { useStore } from '../store';
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

  useEffect(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('melomaniac.settings') ?? '{}'); } catch { return {}; } })();
    const theme = saved.theme ?? 'warm';
    if (theme === 'custom') { writeCustomHue(saved.customAccentHue ?? saved.accentHue ?? 28); applyTheme('custom'); }
    else { applyTheme(theme); }
    // Load library then eagerly prefetch all track artwork into the cache.
    // By the time the user sees Library or NowPlaying the images are ready.
    loadLibrary().then(() => {
      const { tracks } = useStore.getState();
      tracks.forEach(t => { if (t.artwork_hash) getTrackArtwork(t.hash, t.artwork_hash); });
    });
    // Restore last-selected playlist after playlists load and pre-populate the queue
    loadPlaylists().then(() => {
      const { playlists, setCurrentPlaylist, setPlayingBranch, loadQueue, branchByPlaylist } = useStore.getState();
      if (!playlists.length) return;
      const saved = localStorage.getItem('mm_last_playlist');
      const targetId = (saved && playlists.find(p => p.id === saved)) ? saved : playlists[0].id;
      const pl = playlists.find(p => p.id === targetId)!;
      setCurrentPlaylist(targetId);
      const branchName = useStore.getState().currentBranchName;
      const validBranch = pl.branches.find(b => b.name === branchName)?.name ?? pl.branches.find(b => b.name === 'main')?.name ?? pl.branches[0]?.name ?? 'main';
      setPlayingBranch(validBranch);
      invoke<import('../store/types').PlaylistTrackRecord[]>('playlist_get_tracks', { playlistId: targetId, branchName: validBranch })
        .then(ptracks => {
          loadQueue(ptracks.map(t => t.hash));
          useStore.getState().hydrateTracksFromPlaylist(ptracks);
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

  // ── Background peer poll — drives auto-sync when a known device comes online ──
  useEffect(() => {
    refreshLivePeers()
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
      if (payload === 'RemoteNextTrack')     { playNext(true); return; }
      if (payload === 'RemotePreviousTrack') { playPrev(); return; }
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
