import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../../store';
import { RepeatMode, ShuffleMode } from '../../store/types';
import type { TrackRecord, PlaylistRecord, PlaylistTrackRecord, BranchRecord } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef, loopStateRef } from '../playerContext';
import { Icons } from '../icons';
import { MMArt, MMSheet, MMTabBar, MarqueeText } from './common';
import type { TabId } from './common';

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function CoverflowCard({ track, size, glow }: { track: TrackRecord; size: number; glow: boolean }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return <MMArt src={artUrl ?? undefined} size={size} radius={14} glow={glow}/>;
}


function QueueSheetRow({ track }: { track: TrackRecord }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <MMArt src={artUrl ?? undefined} size={36} radius={6}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist ?? 'Unknown Artist'}</div>
      </div>
    </div>
  );
}

const QUEUE_ROW_H = 52;

function QueueRow({ track, isActive, isPlaying, onClick }: {
  track: TrackRecord;
  isActive: boolean;
  isPlaying: boolean;
  onClick: () => void;
}) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return (
    <div
      onClick={onClick}
      style={{
        height: QUEUE_ROW_H, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 0 0 4px', cursor: 'pointer',
        background: isActive ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
        borderLeft: `2.5px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isActive
          ? <span style={{ color: 'var(--accent)', display: 'flex' }}>{isPlaying ? <Icons.pause size={13}/> : <Icons.play size={13}/>}</span>
          : <span style={{ color: 'var(--text-3)', display: 'flex' }}><Icons.play size={12}/></span>
        }
      </div>
      <MMArt src={artUrl ?? undefined} size={34} radius={6}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText
          text={track.title}
          active={isActive}
          textStyle={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent)' : 'var(--text-0)' }}
        />
        <div style={{
          fontSize: 11, color: 'var(--text-2)', marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.artist ?? 'Unknown Artist'}</div>
      </div>
      {/* drag handle — touch-action:none so browser won't intercept as scroll */}
      <div style={{
        width: 40, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, touchAction: 'none', cursor: 'grab',
      }}>
        <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor" style={{ color: 'var(--text-3)', opacity: 0.6 }}>
          <rect x="0" y="0" width="12" height="1.5" rx="0.75"/>
          <rect x="0" y="4.25" width="12" height="1.5" rx="0.75"/>
          <rect x="0" y="8.5" width="12" height="1.5" rx="0.75"/>
        </svg>
      </div>
    </div>
  );
}

function PlaylistSwitcherCard({ playlist, active, onSelect }: {
  playlist: PlaylistRecord; active: boolean; onSelect: () => void;
}) {
  const artUrl = usePlaylistArtwork(playlist.id);
  return (
    <div onClick={onSelect} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px',
      borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer',
    }}>
      <MMArt src={artUrl ?? undefined} size={44} radius={8}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playlist.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          {playlist.branches.length} branch{playlist.branches.length !== 1 ? 'es' : ''}
        </div>
      </div>
      {active && <Icons.check size={16} stroke="var(--accent)"/>}
    </div>
  );
}

function SecondaryBtn({ Icon, active, color = 'var(--accent)', onClick, size = 40 }: {
  Icon: (p: { size?: number }) => React.ReactElement;
  active: boolean;
  color?: string;
  onClick?: () => void;
  size?: number;
}) {
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: size / 2,
      background: active ? `${color}1c` : 'transparent',
      border: active ? `1px solid ${color}55` : '1px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: active ? color : 'var(--text-1)',
    }}>
      <Icon size={Math.round(size * 0.45)}/>
    </button>
  );
}

const COVERFLOW_WINDOW = 4; // cards mounted on each side of the visible center

function MMCoverflow({ tracks, activeIndex, onBrowse, size = 200 }: {
  tracks: TrackRecord[];
  activeIndex: number;
  onBrowse?: (idx: number) => void;
  size?: number;
}) {
  const wrapRef       = useRef<HTMLDivElement>(null);
  const cardRefs      = useRef<(HTMLDivElement | null)[]>([]);
  const posRef        = useRef(activeIndex);
  const dragX         = useRef<number | null>(null);
  const dragP         = useRef(0);
  const dragging      = useRef(false);
  const animFr        = useRef<number | null>(null);
  const lastBrowseRef = useRef(activeIndex);
  // windowCenter drives both the glow and which cards are mounted.
  // Updated on every integer-position crossing so the window follows during drag/animation.
  const [windowCenter, setWindowCenter] = useState(activeIndex);
  const lastWindowRef = useRef(activeIndex);

  const nudgeWindow = (pos: number) => {
    const r = Math.round(pos);
    if (r !== lastWindowRef.current) { lastWindowRef.current = r; setWindowCenter(r); }
  };

  // Write transforms imperatively — no React re-render per frame
  const applyTransforms = useCallback((pos: number) => {
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const off = i - pos, abs = Math.abs(off);
      if (abs > 2.5) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform = `translateX(${off * (size * 0.62)}px) scale(${1 - Math.min(abs, 2) * 0.18}) rotateY(${-off * 26}deg) translateZ(${-Math.min(abs, 2) * 60}px)`;
      el.style.opacity   = String(Math.max(0.18, 1 - abs * 0.32));
      el.style.zIndex    = String(Math.round(10 - abs));
    });
  }, [size]);

  const hadTracksRef = useRef(tracks.length > 0);

  useLayoutEffect(() => {
    const justLoaded = !hadTracksRef.current && tracks.length > 0;
    hadTracksRef.current = hadTracksRef.current || tracks.length > 0;
    if (justLoaded) {
      posRef.current        = activeIndex;
      prevActiveRef.current = activeIndex;
      lastBrowseRef.current = activeIndex;
      lastWindowRef.current = activeIndex;
      setWindowCenter(activeIndex);
    }
    applyTransforms(posRef.current);
  });

  const prevActiveRef = useRef(activeIndex);
  useEffect(() => {
    if (prevActiveRef.current === activeIndex) return;
    prevActiveRef.current = activeIndex;
    lastBrowseRef.current = activeIndex;
    animateTo(activeIndex);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const animateTo = (t: number) => {
    if (animFr.current) cancelAnimationFrame(animFr.current);
    posRef.current = Math.max(0, Math.min(tracks.length - 1, posRef.current));
    const s = posRef.current, d = t - s;
    if (Math.abs(d) < 0.001) {
      posRef.current = t; applyTransforms(t);
      lastWindowRef.current = Math.round(t); setWindowCenter(Math.round(t));
      return;
    }
    const t0 = performance.now(), dur = 340;
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      posRef.current = s + d * e;
      applyTransforms(posRef.current);
      nudgeWindow(posRef.current);
      if (p < 1) animFr.current = requestAnimationFrame(step);
      else { lastWindowRef.current = Math.round(t); setWindowCenter(Math.round(t)); }
    };
    animFr.current = requestAnimationFrame(step);
  };

  const startDrag = (x: number) => {
    if (animFr.current) cancelAnimationFrame(animFr.current);
    dragX.current = x; dragP.current = posRef.current; dragging.current = false;
  };
  const moveDrag = (x: number) => {
    if (dragX.current === null) return;
    const dx = x - dragX.current;
    if (Math.abs(dx) > 4) dragging.current = true;
    if (!dragging.current) return;
    const w = wrapRef.current?.offsetWidth || 360;
    posRef.current = Math.max(0, Math.min(tracks.length - 1, dragP.current - dx / (w / 2.5)));
    applyTransforms(posRef.current);
    nudgeWindow(posRef.current);
    const rounded = Math.round(posRef.current);
    if (rounded !== lastBrowseRef.current) { lastBrowseRef.current = rounded; onBrowse?.(rounded); }
  };
  const endDrag = () => {
    if (dragX.current === null) return;
    const was = dragging.current;
    dragX.current = null; dragging.current = false;
    if (!was) return;
    const snapped = Math.max(0, Math.min(tracks.length - 1, Math.round(posRef.current)));
    lastBrowseRef.current = snapped;
    onBrowse?.(snapped);
    animateTo(snapped);
  };

  if (tracks.length === 0) {
    return (
      <div style={{ width: '100%', height: size + 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <MMArt size={size} radius={14}/>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onTouchStart={e => startDrag(e.touches[0].clientX)}
      onTouchMove={e => moveDrag(e.touches[0].clientX)}
      onTouchEnd={endDrag}
      onMouseDown={e => { e.preventDefault(); startDrag(e.clientX); }}
      onMouseMove={e => { if (dragX.current !== null) moveDrag(e.clientX); }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      style={{
        position: 'relative', width: '100%', height: size + 32,
        perspective: '900px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'pan-y', userSelect: 'none', cursor: 'grab',
      }}
    >
      {tracks.map((track, i) => {
        // Skip mounting cards outside the window — no hook cost for off-screen tracks
        if (Math.abs(i - windowCenter) > COVERFLOW_WINDOW) return null;
        const off = i - posRef.current;
        const abs = Math.abs(off);
        const hidden = abs > 2.5;
        return (
          <div
            key={track.hash}
            ref={el => { cardRefs.current[i] = el; }}
            style={{
              position: 'absolute', left: '50%', marginLeft: -size / 2,
              willChange: 'transform',
              display: hidden ? 'none' : '',
              transform: hidden ? undefined : `translateX(${off * (size * 0.62)}px) scale(${1 - Math.min(abs, 2) * 0.18}) rotateY(${-off * 26}deg) translateZ(${-Math.min(abs, 2) * 60}px)`,
              opacity: hidden ? undefined : Math.max(0.18, 1 - abs * 0.32),
              zIndex: hidden ? undefined : Math.round(10 - abs),
            }}
          >
            <CoverflowCard track={track} size={size} glow={i === windowCenter}/>
          </div>
        );
      })}
    </div>
  );
}

export function NowPlaying({ onTab }: { onTab: (id: TabId) => void }) {
  const loadedTrackHash    = useStore(s => s.loadedTrackHash);
  const isPlaying          = useStore(s => s.isPlaying);
  const duration_ms        = useStore(s => s.duration_ms);
  const setPlaying         = useStore(s => s.setPlaying);
  const setLoaded          = useStore(s => s.setLoaded);
  const tracks             = useStore(s => s.tracks);
  const queueTracks        = useStore(s => s.queueTracks);
  const currentIndex       = useStore(s => s.currentIndex);
  const advance            = useStore(s => s.advance);
  const retreat            = useStore(s => s.retreat);
  const jumpTo             = useStore(s => s.jumpTo);
  const loadQueue          = useStore(s => s.loadQueue);
  const shuffle            = useStore(s => s.shuffle);
  const setShuffle         = useStore(s => s.setShuffle);
  const setRepeat          = useStore(s => s.setRepeat);
  const shuffledQueue      = useStore(s => s.shuffledQueue);
  const shuffleIndex       = useStore(s => s.shuffleIndex);
  const toggleFavorite     = useStore(s => s.toggleFavorite);
  const playlists          = useStore(s => s.playlists);
  const currentPlaylistId  = useStore(s => s.currentPlaylistId);
  const setCurrentPlaylist = useStore(s => s.setCurrentPlaylist);

  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId) ?? null;
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showBranchSheet, setShowBranchSheet] = useState(false);
  const [activeBranch, setActiveBranch] = useState(() => localStorage.getItem('mm_active_branch') ?? 'main');
  const activeBranchRef = useRef(localStorage.getItem('mm_active_branch') ?? 'main');

  const setAndPersistBranch = useCallback((name: string) => {
    localStorage.setItem('mm_active_branch', name);
    activeBranchRef.current = name;
    setActiveBranch(name);
  }, []);
  const [showQueue, setShowQueue] = useState(false);
  const [listScrolled, setListScrolled] = useState(false);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-to-reorder state
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [ghostTop, setGhostTop] = useState(0);
  const isDraggingRef      = useRef(false);
  const draggingIdxRef     = useRef<number | null>(null);
  const dropTargetIdxRef   = useRef<number | null>(null);
  const dragGhostRef       = useRef<HTMLDivElement>(null);
  const queueRecordsRef    = useRef<TrackRecord[]>([]);
  const queueTracksRef     = useRef<string[]>([]);
  const currentPlaylistIdRef = useRef<string | null>(null);
  const loadQueueRef       = useRef(loadQueue);

  const handleListScroll = useCallback(() => {
    if (!listParentRef.current) return;
    if (listParentRef.current.scrollTop <= 40) {
      if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null; }
      setListScrolled(false);
      return;
    }
    setListScrolled(true);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => setListScrolled(false), 2500);
  }, []);

  type LoopMode = 'off' | 'one' | 'ab';
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  const [abA, setAbA] = useState(0);
  const [abB, setAbB] = useState(1);
  const [trackAbPoints, setTrackAbPoints] = useState<Record<string, { a: number; b: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.ab_points') ?? '{}'); } catch { return {}; }
  });
  const abPointsRef      = useRef(trackAbPoints);
  abPointsRef.current    = trackAbPoints;
  const abCommitRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abDragging       = useRef<'A' | 'B' | null>(null);
  const isSeekDragging   = useRef(false);
  const seekBarRef       = useRef<HTMLDivElement>(null);
  const browseTrackRef   = useRef<TrackRecord | null>(null);
  const isBrowsingRef    = useRef(false);

  const queueRecords: TrackRecord[] = queueTracks
    .map(h => tracks.find(t => t.hash === h))
    .filter((t): t is TrackRecord => t !== undefined);

  const listParentRef = useRef<HTMLDivElement>(null);
  const activeListIndex = queueRecords.findIndex(t => t.hash === loadedTrackHash);

  // browseIndex tracks which coverflow card is centered; resets when the playing track changes
  const [browseIndex, setBrowseIndex] = useState(Math.max(0, activeListIndex));
  useEffect(() => { if (activeListIndex >= 0) setBrowseIndex(activeListIndex); }, [activeListIndex]);

  const currentTrack = tracks.find(t => t.hash === loadedTrackHash) ?? null;
  const browseTrack  = queueRecords[browseIndex] ?? currentTrack;
  const isBrowsing   = browseTrack !== null && browseTrack.hash !== (loadedTrackHash ?? '');
  // Prefetch current track artwork into the shared cache; CoverflowCard will pick it up instantly
  useTrackArtwork(loadedTrackHash ?? '', currentTrack?.artwork_hash ?? null);

  // Seek bar DOM refs — updated by rAF, never by React state
  const seekFillRef = useRef<HTMLDivElement>(null);
  const posTextRef  = useRef<HTMLSpanElement>(null);
  const durTextRef  = useRef<HTMLSpanElement>(null);
  const thumbRef    = useRef<HTMLDivElement>(null);
  const durRef      = useRef(duration_ms);
  useEffect(() => { durRef.current = duration_ms; loopStateRef.durMs = duration_ms; }, [duration_ms]);

  useEffect(() => {
    if (!loadedTrackHash) return;
    const pts = abPointsRef.current[loadedTrackHash];
    const a = pts?.a ?? 0, b = pts?.b ?? 1;
    setAbA(a); setAbB(b);
    loopStateRef.abA = a; loopStateRef.abB = b;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTrackHash]);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const pos = positionMsRef.current;
      const dur = durRef.current;
      if (isBrowsingRef.current && browseTrackRef.current) {
        const bd = browseTrackRef.current.duration_ms;
        if (seekFillRef.current) seekFillRef.current.style.width = '0%';
        if (thumbRef.current)    thumbRef.current.style.left    = '0%';
        if (posTextRef.current)  posTextRef.current.textContent = '0:00';
        if (durTextRef.current)  durTextRef.current.textContent = bd > 0 ? fmtMs(bd) : '0:00';
      } else if (dur > 0) {
        const pct = Math.min(pos / dur, 1) * 100;
        if (seekFillRef.current) seekFillRef.current.style.width = `${pct}%`;
        if (thumbRef.current)    thumbRef.current.style.left    = `${pct}%`;
        if (posTextRef.current)  posTextRef.current.textContent = fmtMs(pos);
        if (durTextRef.current)  durTextRef.current.textContent = fmtMs(dur);
      } else {
        if (posTextRef.current) posTextRef.current.textContent = '0:00';
        if (durTextRef.current) durTextRef.current.textContent = '0:00';
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playTrack = (track: TrackRecord) => {
    setLoaded(track.hash, track.duration_ms);
    positionMsRef.current = 0;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    setPlaying(true);
  };

  const handlePlayPause = () => {
    if (isBrowsing && browseTrack) {
      jumpTo(browseIndex);
      playTrack(browseTrack);
      return;
    }
    if (isPlaying) {
      invoke('audio_pause').catch(console.error);
      setPlaying(false);
    } else {
      invoke('audio_play').catch(console.error);
      setPlaying(true);
    }
  };

  const handleNext = () => {
    advance();
    const hash = useStore.getState().currentHash();
    if (!hash) return;
    const track = useStore.getState().tracks.find(t => t.hash === hash);
    if (track) playTrack(track);
  };

  const handlePrev = () => {
    if (positionMsRef.current > 3000) {
      positionMsRef.current = 0;
      invoke('audio_seek', { positionMs: 0 }).catch(console.error);
    } else {
      retreat();
      const hash = useStore.getState().currentHash();
      if (!hash) return;
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (track) playTrack(track);
    }
  };

  // Coverflow browsing is purely visual — never touches the queue cursor.
  // currentIndex only changes via advance/retreat/explicit play so auto-advance stays correct.

  const handleShuffle = () => {
    const cycle = [ShuffleMode.Off, ShuffleMode.Smart, ShuffleMode.Random] as const;
    setShuffle(cycle[(cycle.indexOf(shuffle) + 1) % cycle.length]);
  };

  const scheduleAbCommit = (a: number, b: number) => {
    if (!loadedTrackHash) return;
    const hash = loadedTrackHash;
    const updated = { ...abPointsRef.current, [hash]: { a, b } };
    setTrackAbPoints(updated);
    abPointsRef.current = updated;
    localStorage.setItem('melomaniac.ab_points', JSON.stringify(updated));
    if (!currentPlaylistId) return;
    if (abCommitRef.current) clearTimeout(abCommitRef.current);
    abCommitRef.current = setTimeout(() => {
      const dur = loopStateRef.durMs;
      if (dur <= 0) return;
      const isFullRange = a < 0.001 && b > 0.999;
      invoke('playlist_set_ab_loop', {
        playlistId: currentPlaylistId,
        branchName: activeBranch,
        trackHash: hash,
        abStartMs: isFullRange ? null : Math.round(a * dur),
        abEndMs:   isFullRange ? null : Math.round(b * dur),
      }).catch(console.error);
    }, 1500);
  };

  const handleLoopCycle = () => {
    setLoopMode(prev => {
      const next: LoopMode = prev === 'off' ? 'one' : prev === 'one' ? 'ab' : 'off';
      loopStateRef.loopMode = next;
      setRepeat(next === 'one' ? RepeatMode.One : RepeatMode.None);
      return next;
    });
  };

  const getSeekPct = (clientX: number) => {
    if (!seekBarRef.current) return 0;
    const r = seekBarRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pct = getSeekPct(e.clientX);
    if (loopMode === 'ab') {
      if (Math.abs(pct - abA) < 0.05) { abDragging.current = 'A'; return; }
      if (Math.abs(pct - abB) < 0.05) { abDragging.current = 'B'; return; }
    }
    isSeekDragging.current = true;
    const newPos = Math.round(pct * durRef.current);
    positionMsRef.current = newPos;
    invoke('audio_seek', { positionMs: newPos }).catch(console.error);
  };

  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (abDragging.current) {
      const pct = getSeekPct(e.clientX);
      if (abDragging.current === 'A') {
        const val = Math.min(pct, abB - 0.02);
        setAbA(val); loopStateRef.abA = val;
        scheduleAbCommit(val, abB);
      } else {
        const val = Math.max(pct, abA + 0.02);
        setAbB(val); loopStateRef.abB = val;
        scheduleAbCommit(abA, val);
      }
      return;
    }
    if (!isSeekDragging.current) return;
    const pct = getSeekPct(e.clientX);
    const newPos = Math.round(pct * durRef.current);
    positionMsRef.current = newPos;
    invoke('audio_seek', { positionMs: newPos }).catch(console.error);
  };

  const handleSeekPointerUp = () => { abDragging.current = null; isSeekDragging.current = false; };

  loopStateRef.loopMode = loopMode;
  loopStateRef.abA = abA;
  loopStateRef.abB = abB;
  browseTrackRef.current     = browseTrack;
  isBrowsingRef.current      = isBrowsing;
  queueRecordsRef.current      = queueRecords;
  queueTracksRef.current       = queueTracks;
  currentPlaylistIdRef.current = currentPlaylistId ?? null;
  loadQueueRef.current       = loadQueue;
  draggingIdxRef.current     = draggingIdx;
  dropTargetIdxRef.current   = dropTargetIdx;


  const accent = 'var(--accent)';

  const coverflowItems = queueRecords.length > 0
    ? queueRecords
    : currentTrack ? [currentTrack] : [];

  const queueVirtualizer = useVirtualizer({
    count: queueRecords.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => QUEUE_ROW_H,
    overscan: 5,
  });

  useEffect(() => {
    if (activeListIndex >= 0) {
      queueVirtualizer.scrollToIndex(activeListIndex, { align: 'center', behavior: 'smooth' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListIndex]);

  // Imperative drag-to-reorder — non-passive listeners so we can preventDefault()
  // before the browser commits to scroll. Works for both touch (mobile) and mouse (desktop).
  useEffect(() => {
    const el = listParentRef.current;
    if (!el) return;
    const HANDLE_PX = 40;

    const activate = (clientX: number, clientY: number): boolean => {
      const rect = el.getBoundingClientRect();
      if (clientX < rect.right - HANDLE_PX) return false;
      const idx = Math.floor((clientY - rect.top + el.scrollTop) / QUEUE_ROW_H);
      if (idx < 0 || idx >= queueRecordsRef.current.length) return false;
      isDraggingRef.current = true;
      draggingIdxRef.current = idx;
      dropTargetIdxRef.current = idx;
      setDraggingIdx(idx);
      setDropTargetIdx(idx);
      setGhostTop(clientY - QUEUE_ROW_H / 2);
      if (navigator.vibrate) navigator.vibrate(30);
      return true;
    };

    const move = (clientY: number) => {
      if (!isDraggingRef.current) return;
      if (dragGhostRef.current) dragGhostRef.current.style.top = `${clientY - QUEUE_ROW_H / 2}px`;
      const rect = el.getBoundingClientRect();
      const idx = Math.min(Math.max(0, Math.floor((clientY - rect.top + el.scrollTop) / QUEUE_ROW_H)), queueRecordsRef.current.length - 1);
      if (idx !== dropTargetIdxRef.current) {
        dropTargetIdxRef.current = idx;
        setDropTargetIdx(idx);
      }
    };

    const finish = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const from = draggingIdxRef.current, to = dropTargetIdxRef.current;
      draggingIdxRef.current = null;
      dropTargetIdxRef.current = null;
      setDraggingIdx(null);
      setDropTargetIdx(null);
      if (from !== null && to !== null && from !== to) {
        const newHashes = [...queueTracksRef.current];
        const [moved] = newHashes.splice(from, 1);
        newHashes.splice(to, 0, moved);
        loadQueueRef.current(newHashes);
        const plId = currentPlaylistIdRef.current;
        if (plId) invoke('playlist_reorder_tracks', { playlistId: plId, branchName: activeBranchRef.current, orderedHashes: newHashes }).catch(console.error);
      }
    };

    // Touch
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (activate(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      e.preventDefault();
      move(e.touches[0].clientY);
    };

    // Mouse
    const onMouseDown = (e: MouseEvent) => {
      if (!activate(e.clientX, e.clientY)) return;
      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientY);
    const onMouseUp   = () => {
      finish();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    el.addEventListener('touchstart',  onTouchStart, { passive: false });
    el.addEventListener('touchmove',   onTouchMove,  { passive: false });
    el.addEventListener('touchend',    finish);
    el.addEventListener('touchcancel', finish);
    el.addEventListener('mousedown',   onMouseDown);
    return () => {
      el.removeEventListener('touchstart',  onTouchStart);
      el.removeEventListener('touchmove',   onTouchMove);
      el.removeEventListener('touchend',    finish);
      el.removeEventListener('touchcancel', finish);
      el.removeEventListener('mousedown',   onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueRecords.length > 0]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%',
        background: `radial-gradient(circle, var(--accent)38 0%, var(--accent)10 35%, transparent 70%)`,
        filter: 'blur(20px)', pointerEvents: 'none',
      }}/>

      <div style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 16 }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 22px 8px' }}>
          <button
            onClick={() => setShowSwitcher(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0 }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
              {currentPlaylist?.name ?? currentTrack?.album ?? (loadedTrackHash ? 'Library' : 'Nothing Playing')}
            </span>
            <Icons.chevDown size={12} stroke="var(--text-2)"/>
          </button>
          {currentPlaylist && currentPlaylist.branches.length > 0 && (
            <button
              onClick={() => setShowBranchSheet(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', borderRadius: 99, padding: '2px 8px 2px 6px', cursor: 'pointer', flexShrink: 0 }}
            >
              <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>⎇</span>
              <span style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'JetBrains Mono, monospace', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeBranch}</span>
              <Icons.chevDown size={10} stroke="var(--text-2)"/>
            </button>
          )}
        </div>

        {/* coverflow */}
        <div style={{ flexShrink: 0, marginTop: 6, marginBottom: 8 }}>
          <MMCoverflow
            tracks={coverflowItems}
            activeIndex={activeListIndex >= 0 ? Math.min(activeListIndex, coverflowItems.length - 1) : Math.min(currentIndex, Math.max(0, coverflowItems.length - 1))}
            onBrowse={setBrowseIndex}
            size={180}
          />
        </div>

        {/* track info — shows browsed track while scrolling */}
        <div style={{ padding: '4px 28px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>
            {browseTrack?.title ?? '—'}
          </div>
          <div style={{ fontSize: 14, color: isBrowsing ? 'var(--text-2)' : 'var(--text-1)', marginTop: 4 }}>
            {browseTrack
              ? `${browseTrack.artist ?? 'Unknown Artist'}${browseTrack.album ? ` · ${browseTrack.album}` : ''}`
              : 'No track loaded'}
          </div>
          {loopMode === 'ab' && duration_ms > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 3, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.05 }}>
              A·B {fmtMs(abA * duration_ms)} → {fmtMs(abB * duration_ms)}
            </div>
          )}
        </div>

        {/* seek bar */}
        <div style={{ padding: '12px 28px 8px' }}>
          <div
            ref={seekBarRef}
            onPointerDown={handleSeekPointerDown}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={handleSeekPointerUp}
            style={{ position: 'relative', height: 36, display: 'flex', alignItems: 'center', cursor: loopMode === 'ab' ? 'default' : 'pointer', touchAction: 'none' }}
          >
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--bg-3)', position: 'relative', overflow: 'visible' }}>
              {loopMode === 'ab' && (
                <div style={{
                  position: 'absolute', left: `${abA * 100}%`, width: `${(abB - abA) * 100}%`,
                  top: 0, bottom: 0, borderRadius: 2,
                  background: 'var(--accent)', opacity: 0.25, pointerEvents: 'none',
                }}/>
              )}
              <div ref={seekFillRef} style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%',
                background: `linear-gradient(90deg, ${accent}, var(--accent-light))`, borderRadius: 2,
                boxShadow: `0 0 12px ${accent}88`,
              }}/>
              {loopMode !== 'ab' && (
                <div ref={thumbRef} style={{
                  position: 'absolute', left: '0%', top: '50%',
                  width: 14, height: 14, transform: 'translate(-50%,-50%)',
                  background: 'var(--text-0)', borderRadius: '50%',
                  boxShadow: `0 0 8px ${accent}, 0 2px 6px rgba(0,0,0,0.5)`,
                }}/>
              )}
              {loopMode === 'ab' && (
                <>
                  <div style={{
                    position: 'absolute', left: `${abA * 100}%`, top: '50%',
                    transform: 'translate(-50%,-50%)',
                    width: 16, height: 24, borderRadius: 4,
                    background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700, color: 'var(--bg-0)', fontFamily: 'JetBrains Mono, monospace',
                    cursor: 'ew-resize',
                  }}>A</div>
                  <div style={{
                    position: 'absolute', left: `${abB * 100}%`, top: '50%',
                    transform: 'translate(-50%,-50%)',
                    width: 16, height: 24, borderRadius: 4,
                    background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700, color: 'var(--bg-0)', fontFamily: 'JetBrains Mono, monospace',
                    cursor: 'ew-resize',
                  }}>B</div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span ref={posTextRef} style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>0:00</span>
            <span ref={durTextRef} style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>0:00</span>
          </div>
        </div>

        {/* controls — shuffle / heart / prev / play / next / loop / queue */}
        {(() => {
          const ShuffleIco = shuffle === ShuffleMode.Random ? Icons.shuffleRandom : Icons.shuffle;
          const LoopIco = loopMode === 'ab' ? Icons.ab : loopMode === 'one' ? Icons.loopOne : Icons.loop;
          const tBtn = (onClick: () => void, children: React.ReactNode): React.ReactElement => (
            <button onClick={onClick} style={{
              width: 44, height: 44, background: 'transparent', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', borderRadius: 22, flexShrink: 0,
            }}>{children}</button>
          );
          return (
            <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', padding: '2px 12px 8px' }}>
              <SecondaryBtn Icon={ShuffleIco} active={shuffle !== ShuffleMode.Off} onClick={handleShuffle} size={36}/>
              <SecondaryBtn Icon={Icons.heartFill} active={browseTrack?.favorited ?? false} color={accent} onClick={() => browseTrack && toggleFavorite(browseTrack.hash)} size={36}/>
              {tBtn(handlePrev, <Icons.prev size={24} stroke="var(--text-0)"/>)}
              <button onClick={handlePlayPause} style={{
                width: 68, height: 68, borderRadius: 34, border: 'none', flexShrink: 0,
                background: `linear-gradient(135deg, var(--accent-light), ${accent})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 6px 22px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.25)`,
                color: 'var(--bg-0)', cursor: 'pointer',
              }}>
                {isBrowsing ? <Icons.play size={28}/> : isPlaying ? <Icons.pause size={28}/> : <Icons.play size={28}/>}
              </button>
              {tBtn(handleNext, <Icons.next size={24} stroke="var(--text-0)"/>)}
              <SecondaryBtn Icon={LoopIco} active={loopMode !== 'off'} onClick={handleLoopCycle} size={36}/>
              <SecondaryBtn Icon={Icons.queue} active={showQueue} onClick={() => setShowQueue(true)} size={36}/>
            </div>
          );
        })()}

        {/* Playlist / library song list */}
        {queueRecords.length > 0 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '0.5px solid var(--border-0)', marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 20px 4px', flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.1, fontFamily: 'JetBrains Mono, monospace' }}>
                {currentPlaylist?.name ?? 'Library'}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                {queueRecords.length} tracks{shuffle === ShuffleMode.Smart ? ' · smart' : shuffle === ShuffleMode.Random ? ' · random' : ''}
              </span>
            </div>
            <div
              ref={listParentRef}
              onScroll={handleListScroll}
              style={{ flex: 1, overflowY: 'auto' }}
              className="mm-scroll"
            >
              <div style={{ height: queueVirtualizer.getTotalSize(), position: 'relative' }}>
                {queueVirtualizer.getVirtualItems().map(vItem => {
                  const track = queueRecords[vItem.index];
                  if (!track) return null;
                  const isDropTarget = dropTargetIdx === vItem.index && draggingIdx !== null && draggingIdx !== vItem.index;
                  return (
                    <div
                      key={track.hash}
                      style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: QUEUE_ROW_H,
                        transform: `translateY(${vItem.start}px)`,
                        borderTop: isDropTarget ? '2px solid var(--accent)' : '2px solid transparent',
                        opacity: draggingIdx === vItem.index ? 0.3 : 1,
                      }}
                    >
                      <QueueRow
                        track={track}
                        isActive={track.hash === loadedTrackHash}
                        isPlaying={isPlaying}
                        onClick={() => { if (draggingIdx === null) { jumpTo(vItem.index); playTrack(track); } }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* tab bar clearance */}
              <div style={{ height: 86 }}/>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 8 }}/>
        )}
      </div>

      <MMTabBar active="now" onTab={onTab} style={{
        transform: listScrolled ? 'translateY(86px)' : 'translateY(0)',
        transition: 'transform 0.35s ease',
      }}/>

      {/* Drag ghost */}
      {draggingIdx !== null && (
        <div ref={dragGhostRef} style={{
          position: 'fixed', left: 12, right: 12, height: QUEUE_ROW_H,
          top: ghostTop, zIndex: 200, pointerEvents: 'none',
          background: 'var(--bg-3)', borderRadius: 10, opacity: 0.92,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 10px',
        }}>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
            <rect x="0" y="0" width="14" height="1.5" rx="0.75"/>
            <rect x="0" y="4.25" width="14" height="1.5" rx="0.75"/>
            <rect x="0" y="8.5" width="14" height="1.5" rx="0.75"/>
          </svg>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {queueRecords[draggingIdx]?.title ?? ''}
          </div>
        </div>
      )}

      {/* Queue sheet */}
      {showQueue && (() => {
        const nowPlaying = currentTrack;
        const comingUp = shuffle !== ShuffleMode.Off
          ? shuffledQueue.slice(shuffleIndex + 1, shuffleIndex + 11)
              .map(h => tracks.find(t => t.hash === h))
              .filter((t): t is TrackRecord => t !== undefined)
          : queueRecords.slice(currentIndex + 1, currentIndex + 11);
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
            <div onClick={() => setShowQueue(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
            <MMSheet title="Queue" subtitle={shuffle !== ShuffleMode.Off ? 'Shuffle on' : undefined} height="55%" animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }} onClose={() => setShowQueue(false)}>
              {nowPlaying && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 2 }}>Now Playing</div>
                  <div style={{ animation: 'mmFadeSlide 0.25s ease both', animationDelay: '0ms' }}>
                    <QueueSheetRow track={nowPlaying}/>
                  </div>
                </>
              )}
              {comingUp.length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginTop: 14, marginBottom: 2 }}>Coming Up</div>
                  {comingUp.map((t, i) => (
                    <div key={t.hash} style={{ animation: 'mmFadeSlide 0.25s ease both', animationDelay: `${i * 40}ms` }}>
                      <QueueSheetRow track={t}/>
                    </div>
                  ))}
                </>
              )}
              {!nowPlaying && comingUp.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Nothing in the queue yet</div>
              )}
            </MMSheet>
          </div>
        );
      })()}

      {/* Branch switcher sheet */}
      {showBranchSheet && currentPlaylist && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setShowBranchSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title="Switch Branch"
            subtitle={`${currentPlaylist.branches.length} branch${currentPlaylist.branches.length !== 1 ? 'es' : ''}`}
            height="55%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setShowBranchSheet(false)}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {currentPlaylist.branches.map((b: BranchRecord, i: number) => {
                const isActive = b.name === activeBranch;
                return (
                  <div
                    key={b.id}
                    onClick={async () => {
                      if (isActive) { setShowBranchSheet(false); return; }
                      setAndPersistBranch(b.name);
                      try {
                        const ptracks = await invoke<PlaylistTrackRecord[]>('playlist_get_tracks', {
                          playlistId: currentPlaylist.id, branchName: b.name,
                        });
                        loadQueue(ptracks.map(t => t.hash));
                      } catch { /* keep existing queue */ }
                      setShowBranchSheet(false);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 4px',
                      borderBottom: i < currentPlaylist.branches.length - 1 ? '0.5px solid var(--border-0)' : 'none',
                      cursor: 'pointer',
                      animation: `mmFadeSlide 0.22s ease both`,
                      animationDelay: `${i * 35}ms`,
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: isActive ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--bg-3)',
                      border: isActive ? '1px solid var(--accent)44' : '1px solid var(--border-1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, color: isActive ? 'var(--accent)' : 'var(--text-2)' }}>⎇</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--text-0)', fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {b.name}
                      </div>
                      {b.head_commit && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                          {b.head_commit.slice(0, 7)}
                        </div>
                      )}
                    </div>
                    {isActive && <Icons.check size={16} stroke="var(--accent)"/>}
                  </div>
                );
              })}
            </div>
          </MMSheet>
        </div>
      )}

      {/* Playlist quick switcher */}
      {showSwitcher && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setShowSwitcher(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet title="Switch Source" subtitle={`${playlists.length} playlists`} height="70%" animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }} onClose={() => setShowSwitcher(false)}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Library option */}
              <div onClick={() => {
                setCurrentPlaylist('');
                setShowSwitcher(false);
              }} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px',
                borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer',
              }}>
                <MMArt size={44} radius={8}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}>Library</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{tracks.length} tracks</div>
                </div>
                {!currentPlaylistId && <Icons.check size={16} stroke="var(--accent)"/>}
              </div>
              {playlists.map(p => (
                <PlaylistSwitcherCard
                  key={p.id}
                  playlist={p}
                  active={p.id === currentPlaylistId}
                  onSelect={async () => {
                    setCurrentPlaylist(p.id);
                    const defaultBranch = p.branches.find(b => b.name === 'main')?.name ?? p.branches[0]?.name ?? 'main';
                    setAndPersistBranch(defaultBranch);
                    try {
                      const ptracks = await invoke<PlaylistTrackRecord[]>('playlist_get_tracks', {
                        playlistId: p.id, branchName: defaultBranch,
                      });
                      loadQueue(ptracks.map(t => t.hash));
                    } catch { /* keep existing queue */ }
                    setShowSwitcher(false);
                  }}
                />
              ))}
            </div>
          </MMSheet>
        </div>
      )}
    </div>
  );
}
