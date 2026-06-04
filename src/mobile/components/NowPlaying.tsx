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
import { useTrackAccents, withAlpha, useGlowFade } from '../hooks/useTrackAccent';

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const CoverflowCard = React.memo(function CoverflowCard({ track, size, glow }: { track: TrackRecord; size: number; glow: boolean }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return <MMArt src={artUrl ?? undefined} size={size} radius={14} glow={glow}/>;
});


function SwipeToRemove({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  const [dx, setDx] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const startXRef = useRef(0);

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden' }}
      onTouchStart={e => { startXRef.current = e.touches[0].clientX; setSnapping(false); }}
      onTouchMove={e => {
        const d = e.touches[0].clientX - startXRef.current;
        if (d > 0) setDx(Math.min(d, 120));
      }}
      onTouchEnd={() => {
        if (dx > 80) onRemove();
        setSnapping(true);
        setDx(0);
      }}
    >
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%',
        background: '#ef4444', display: 'flex', alignItems: 'center', paddingLeft: 16,
        opacity: Math.min(1, dx / 60),
      }}>
        <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>Remove</span>
      </div>
      <div style={{
        transform: `translateX(${dx}px)`,
        transition: snapping ? 'transform 0.2s ease' : 'none',
        background: 'var(--bg-1)',
      }}>
        {children}
      </div>
    </div>
  );
}

function QueueSheetRow({ track }: { track: TrackRecord }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <MMArt src={artUrl ?? undefined} size={36} radius={6}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText
          text={track.title}
          active={true}
          textStyle={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)' }}
        />
        {track.artist && (
          <MarqueeText
            text={track.artist}
            active={true}
            style={{ marginTop: 1 }}
            textStyle={{ fontSize: 11, color: 'var(--text-2)' }}
          />
        )}
      </div>
    </div>
  );
}

const QUEUE_ROW_H    = 52;
const QUEUE_LIST_H   = 252;
const QUEUE_HEADER_H = 62; // pill (10px) + header row (padding 5+8 + minH 36) + 1px border

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
        {track.artist && <div style={{
          fontSize: 11, color: 'var(--text-2)', marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{track.artist}</div>}
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

function NextTrackArt({ track }: { track: TrackRecord }) {
  const url = useTrackArtwork(track.hash, track.artwork_hash);
  return <MMArt src={url ?? undefined} size={26} radius={5}/>;
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
      background: active ? `${color}1a` : 'transparent',
      border: 'none',
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
    // justLoaded: first time tracks become available after mount (e.g. library loaded async).
    // Resets all position refs so the coverflow snaps to the right card without animation.
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
    // Cancel any in-progress drag so touch handlers don't fight the programmatic animation.
    dragX.current = null;
    dragging.current = false;
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
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%)',
        maskImage: 'linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%)',
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
  // ── Store subscriptions ────────────────────────────────────────────────────
  // meloUpdateNowPlaying fires every ~250ms from Rust; this component only
  // reads the resulting store values — it never drives the position poll itself.
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
  const shuffleIndex          = useStore(s => s.shuffleIndex);
  const removeUpcomingTrack   = useStore(s => s.removeUpcomingTrack);
  const toggleFavorite        = useStore(s => s.toggleFavorite);
  const playlists          = useStore(s => s.playlists);
  const currentPlaylistId  = useStore(s => s.currentPlaylistId);
  const setCurrentPlaylist = useStore(s => s.setCurrentPlaylist);
  const playingBranchName  = useStore(s => s.playingBranchName);
  const setPlayingBranch   = useStore(s => s.setPlayingBranch);

  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId) ?? null;

  // ── Sheet / modal visibility state ────────────────────────────────────────
  // showSwitcher opens the playlist quick-switcher sheet (header playlist button).
  // showBranchSheet opens the branch switcher sheet (header branch pill button).
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showBranchSheet, setShowBranchSheet] = useState(false);
  // activeBranchRef kept for use in non-reactive callbacks (drag reorder, AB loop)
  const activeBranchRef = useRef(playingBranchName);
  useEffect(() => { activeBranchRef.current = playingBranchName; }, [playingBranchName]);

  // ── Queue panel state ──────────────────────────────────────────────────────
  const [showQueue, setShowQueue] = useState(false);
  // queueExpanded persists across sessions; when true the coverflow shrinks to
  // make room — a layout trade-off so both are visible on a small screen.
  const [queueExpanded, setQueueExpanded] = useState(() => localStorage.getItem('mm_queue_expanded') !== 'false');
  // Refs to compute swipe velocity on the queue header drag handle.
  const queueDragStartY = useRef<number | null>(null);
  const queueDragLastY  = useRef(0);
  const queueDragTime   = useRef(0);
  const queueVelocity   = useRef(0);
  // listScrolled temporarily hides the tab bar so the queue list gets extra height.
  const [listScrolled, setListScrolled] = useState(false);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Drag-to-reorder state ──────────────────────────────────────────────────
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [ghostTop, setGhostTop] = useState(0);
  const isDraggingRef      = useRef(false);
  const draggingIdxRef     = useRef<number | null>(null);
  const dropTargetIdxRef   = useRef<number | null>(null);
  const dragGhostRef       = useRef<HTMLDivElement>(null);
  // Refs mirror latest state so the imperative event listeners (registered once)
  // always see the current queue without being re-attached on every render.
  const queueRecordsRef      = useRef<TrackRecord[]>([]);
  const queueTracksRef       = useRef<string[]>([]);
  const currentPlaylistIdRef = useRef<string | null>(null);
  const loadQueueRef         = useRef(loadQueue);

  const handleToggleQueue = useCallback(() => {
    setQueueExpanded(e => {
      const next = !e;
      localStorage.setItem('mm_queue_expanded', String(next));
      if (!next) setListScrolled(false);
      return next;
    });
  }, []);

  const programmaticScrollRef = useRef(false);

  const handleListScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
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

  // ── AB loop state ─────────────────────────────────────────────────────────
  type LoopMode = 'off' | 'one' | 'ab';
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  // abA and abB are fractional positions (0.0–1.0) of total duration, not ms.
  // This makes them resolution-independent and trivial to render on the seek bar.
  const [abA, setAbA] = useState(0);
  const [abB, setAbB] = useState(1);
  // AB points are persisted per-track so they survive navigation between tracks.
  const [trackAbPoints, setTrackAbPoints] = useState<Record<string, { a: number; b: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.ab_points') ?? '{}'); } catch { return {}; }
  });
  const abPointsRef      = useRef(trackAbPoints);
  abPointsRef.current    = trackAbPoints;
  // Debounce DB writes — user may drag A/B many times per second.
  const abCommitRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which AB handle is currently being dragged on the seek bar (null = normal seek).
  const abDragging       = useRef<'A' | 'B' | null>(null);

  // ── Seek bar refs ──────────────────────────────────────────────────────────
  const isSeekDragging   = useRef(false);
  const seekBarRef       = useRef<HTMLDivElement>(null);

  // browseTrackRef / isBrowsingRef are ref mirrors of the derived browseTrack /
  // isBrowsing values — needed inside the rAF loop which cannot close over
  // frequently-changing React state (see "Coverflow browse vs. playing" below).
  const browseTrackRef   = useRef<TrackRecord | null>(null);
  const isBrowsingRef    = useRef(false);

  const queueRecords: TrackRecord[] = queueTracks
    .map(h => tracks.find(t => t.hash === h))
    .filter((t): t is TrackRecord => t !== undefined);

  const listParentRef = useRef<HTMLDivElement>(null);
  const activeListIndex = queueRecords.findIndex(t => t.hash === loadedTrackHash);

  // ── Coverflow browse vs. playing ───────────────────────────────────────────
  // browseIndex is the carousel-centered card index; it is INDEPENDENT of
  // currentIndex (the playing cursor). Swiping the coverflow only sets
  // browseIndex — it never advances the queue or triggers playback.
  // isBrowsing is true whenever the user has swiped away from the playing card.
  const [browseIndex, setBrowseIndex] = useState(Math.max(0, activeListIndex));
  // Snap browseIndex back to the playing card whenever the track changes.
  useEffect(() => { if (activeListIndex >= 0) setBrowseIndex(activeListIndex); }, [activeListIndex]);

  const currentTrack = tracks.find(t => t.hash === loadedTrackHash) ?? null;
  const browseTrack  = queueRecords[browseIndex] ?? currentTrack;
  const isBrowsing   = browseTrack !== null && browseTrack.hash !== (loadedTrackHash ?? '');
  // Call useTrackArtwork here purely as a prefetch — the return value is intentionally ignored;
  // CoverflowCard picks up the result from the shared cache with zero additional IPC.
  useTrackArtwork(loadedTrackHash ?? '', currentTrack?.artwork_hash ?? null);

  // ── Seek bar DOM refs ──────────────────────────────────────────────────────
  // These refs are written directly by the rAF animation loop instead of via
  // React state — avoids a full re-render (and layout) on every animation frame.
  const seekFillRef = useRef<HTMLDivElement>(null);
  const posTextRef  = useRef<HTMLSpanElement>(null);
  const durTextRef  = useRef<HTMLSpanElement>(null);
  const thumbRef    = useRef<HTMLDivElement>(null);
  // durRef shadows duration_ms so the rAF callback always sees the latest value
  // without being restarted whenever duration changes.
  const durRef      = useRef(duration_ms);
  useEffect(() => { durRef.current = duration_ms; loopStateRef.durMs = duration_ms; }, [duration_ms]);

  // Restore per-track AB points when the loaded track changes.
  useEffect(() => {
    if (!loadedTrackHash) return;
    const pts = abPointsRef.current[loadedTrackHash];
    const a = pts?.a ?? 0, b = pts?.b ?? 1;
    setAbA(a); setAbB(b);
    loopStateRef.abA = a; loopStateRef.abB = b;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTrackHash]);

  // ── Seek bar rAF animation loop ────────────────────────────────────────────
  // Reads positionMsRef (updated by Rust events) and writes directly to DOM
  // refs every frame. Using React state here would cause ~60 re-renders/sec.
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

  // ── playTrack ──────────────────────────────────────────────────────────────
  // Single entry-point for starting a track: updates store, resets the shared
  // position ref, fires the Tauri command, and implicitly ends any browse state
  // (browseIndex will be snapped back by the activeListIndex effect above).
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
    if (loadedTrackHash)
      invoke('track_record_skip', { hash: loadedTrackHash, positionMs: positionMsRef.current }).catch(console.error);
    advance();
    const hash = useStore.getState().currentHash();
    if (!hash) return;
    const track = useStore.getState().tracks.find(t => t.hash === hash);
    if (track) playTrack(track);
  };

  // Rewind to start if >3 s in; only retreat to the previous track if near the beginning.
  const handlePrev = () => {
    if (positionMsRef.current > 3000) {
      positionMsRef.current = 0;
      invoke('audio_seek', { positionMs: 0 }).catch(console.error);
    } else {
      if (loadedTrackHash)
        invoke('track_record_skip', { hash: loadedTrackHash, positionMs: positionMsRef.current }).catch(console.error);
      retreat();
      const hash = useStore.getState().currentHash();
      if (!hash) return;
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (track) playTrack(track);
    }
  };

  // ── Secondary controls ─────────────────────────────────────────────────────
  // Coverflow browsing is purely visual — never touches the queue cursor.
  // currentIndex only changes via advance/retreat/explicit play so auto-advance stays correct.

  const handleShuffle = () => {
    const cycle = [ShuffleMode.Off, ShuffleMode.Smart, ShuffleMode.Random] as const;
    setShuffle(cycle[(cycle.indexOf(shuffle) + 1) % cycle.length]);
  };

  // ── AB loop helpers ────────────────────────────────────────────────────────
  // Converts fractional A/B to absolute ms before sending to Rust.
  // Full range (a≈0, b≈1) is sent as null to clear the loop in the DB.
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
        branchName: activeBranchRef.current,
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

  // ── Seek bar pointer handlers ──────────────────────────────────────────────
  const getSeekPct = (clientX: number) => {
    if (!seekBarRef.current) return 0;
    const r = seekBarRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // setPointerCapture routes all subsequent pointer events to this element
    // even when the finger/cursor moves outside — essential for reliable drag
    // on mobile where the touch easily leaves the narrow seek bar.
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

  // ── Sync mutable refs from render ─────────────────────────────────────────
  // These are written every render so event listeners and rAF callbacks always
  // read the latest values without needing to be re-registered.
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

  // ── Accent color ───────────────────────────────────────────────────────────
  // Derived from the browsed (or playing) track's artwork via color extraction.
  // accent1/accent2 drive: halo gradient, seek bar fill, play button glow.
  // Uses the browsed (not playing) track so colors update live during coverflow swipe.
  const [accent1, accent2] = useTrackAccents(
    browseTrack?.hash ?? loadedTrackHash,
    browseTrack?.artwork_hash ?? currentTrack?.artwork_hash ?? null,
  );
  const accent = accent1;
  const { slots: haloSlots, activeSlot: haloActive } = useGlowFade([accent1, accent2]);
  const nextTrack: TrackRecord | null = shuffle !== ShuffleMode.Off
    ? (shuffledQueue[shuffleIndex + 1] ? tracks.find(t => t.hash === shuffledQueue[shuffleIndex + 1]) ?? null : null)
    : (queueRecords[activeListIndex + 1] ?? null);

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
      programmaticScrollRef.current = true;
      queueVirtualizer.scrollToIndex(activeListIndex, { align: 'center', behavior: 'smooth' });
      // smooth scroll takes ~340ms; clear flag with margin so onScroll events are ignored
      const t = setTimeout(() => { programmaticScrollRef.current = false; }, 500);
      return () => clearTimeout(t);
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
  // Re-register listeners only when queue goes from empty to non-empty (or vice versa),
  // not on every queue mutation — the listeners read refs, not closed-over values.
  }, [queueRecords.length > 0]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      {/* Halo — two slots cross-fade so the glow smoothly transitions between tracks */}
      {haloSlots.map((slot, i) => (
        <div key={i} style={{
          position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)',
          width: 560, height: 560, borderRadius: '50%',
          background: `radial-gradient(circle, ${withAlpha(slot[0], 0.40)} 0%, ${withAlpha(slot[1], 0.18)} 42%, transparent 68%)`,
          filter: 'blur(40px)', pointerEvents: 'none',
          opacity: haloActive === i ? 1 : 0,
          transition: 'opacity 0.7s ease',
        }}/>
      ))}

      <div style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 'calc(16px + var(--safe-top))', overflow: 'hidden', paddingBottom: `calc(var(--tab-h) + ${queueRecords.length > 0 ? QUEUE_HEADER_H + (queueExpanded ? QUEUE_LIST_H : 0) : 0}px)`, transition: 'padding-bottom 0.4s cubic-bezier(0.22,1,0.36,1)' }}>

        {/* header — tapping the source name opens the playlist switcher sheet;
             tapping the branch pill (when visible) opens the branch switcher sheet. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 22px 8px', flexShrink: 0 }}>
          <button
            onClick={() => setShowSwitcher(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0 }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
              {currentPlaylist?.name ?? currentTrack?.album ?? (loadedTrackHash ? 'Library' : 'Nothing Playing')}
            </span>
            <Icons.chevDown size={12} stroke="var(--text-2)"/>
          </button>
          {/* Branch pill — only shown when a playlist with branches is active. */}
          {currentPlaylist && currentPlaylist.branches.length > 0 && (
            <button
              onClick={() => setShowBranchSheet(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', borderRadius: 99, padding: '2px 8px 2px 6px', cursor: 'pointer', flexShrink: 0 }}
            >
              <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>⎇</span>
              <span style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'JetBrains Mono, monospace', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playingBranchName}</span>
              <Icons.chevDown size={10} stroke="var(--text-2)"/>
            </button>
          )}
        </div>

        {/* coverflow — flex:1 so it fills available space; maxHeight caps it when queue is expanded.
           Card size also shrinks when expanded so art + controls remain visible simultaneously. */}
        <div style={{
          flex: 1, minHeight: 0, maxHeight: queueExpanded ? 160 : 380,
          marginTop: 6, marginBottom: 8,
          transition: 'max-height 0.4s cubic-bezier(0.22,1,0.36,1)',
          overflow: 'visible', display: 'flex', alignItems: 'center',
        }}>
          <MMCoverflow
            tracks={coverflowItems}
            activeIndex={activeListIndex >= 0 ? Math.min(activeListIndex, coverflowItems.length - 1) : Math.min(currentIndex, Math.max(0, coverflowItems.length - 1))}
            onBrowse={setBrowseIndex}
            size={queueExpanded ? 130 : 260}
          />
        </div>

        {/* track info */}
        <div style={{ padding: '4px 28px 0', flexShrink: 0 }}>
          <MarqueeText
            text={browseTrack?.title ?? '—'}
            active={true}
            style={{ lineHeight: 1.15, textAlign: 'center' }}
            textStyle={{ fontSize: queueExpanded ? 17 : 21, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.3, textAlign: 'center' }}
          />
          {browseTrack?.artist && (
            <MarqueeText
              text={`${browseTrack.artist}${browseTrack.album ? ` · ${browseTrack.album}` : ''}`}
              active={true}
              style={{ marginTop: 4, textAlign: 'center' }}
              textStyle={{ fontSize: 13, color: isBrowsing ? 'var(--text-2)' : 'var(--text-1)', textAlign: 'center' }}
            />
          )}
          {loopMode === 'ab' && duration_ms > 0 && (
            // Multiply fraction by duration_ms here — the only place display needs absolute ms.
            <div style={{ fontSize: 10.5, color: accent, marginTop: 3, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.05 }}>
              A·B {fmtMs(abA * duration_ms)} → {fmtMs(abB * duration_ms)}
            </div>
          )}
        </div>

        {/* seek bar */}
        <div style={{ padding: '12px 28px 8px', flexShrink: 0 }}>
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
                background: `linear-gradient(90deg, ${accent1}, ${accent2})`, borderRadius: 2,
                boxShadow: `0 0 12px ${withAlpha(accent1, 0.5)}`,
              }}/>
              {loopMode !== 'ab' && (
                <div ref={thumbRef} style={{
                  position: 'absolute', left: '0%', top: '50%',
                  width: 14, height: 14, transform: 'translate(-50%,-50%)',
                  background: 'var(--text-0)', borderRadius: '50%',
                  boxShadow: `0 0 10px ${withAlpha(accent1, 0.7)}, 0 2px 4px rgba(0,0,0,0.5)`,
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

        {/* controls — two-row when tracklist collapsed, single-row when expanded to avoid overflow */}
        {(() => {
          const ShuffleIco = shuffle === ShuffleMode.Random ? Icons.shuffleRandom : Icons.shuffle;
          const LoopIco = loopMode === 'ab' ? Icons.ab : loopMode === 'one' ? Icons.loopOne : Icons.loop;
          if (queueExpanded) {
            // Compact single row matching original layout
            const tBtn = (onClick: () => void, children: React.ReactNode): React.ReactElement => (
              <button onClick={onClick} style={{ width: 44, height: 44, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 22, flexShrink: 0 }}>{children}</button>
            );
            return (
              <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', padding: '2px 12px 6px', transition: 'all 0.35s cubic-bezier(0.22,1,0.36,1)', flexShrink: 0 }}>
                <SecondaryBtn Icon={ShuffleIco} active={shuffle !== ShuffleMode.Off} onClick={handleShuffle} size={34}/>
                <SecondaryBtn Icon={Icons.heartFill} active={browseTrack?.favorited ?? false} color={accent} onClick={() => browseTrack && toggleFavorite(browseTrack.hash)} size={34}/>
                {tBtn(handlePrev, <Icons.prev size={22} stroke="var(--text-0)"/>)}
                <button onClick={handlePlayPause} style={{
                  width: 58, height: 58, borderRadius: 29, border: 'none', flexShrink: 0,
                  background: `linear-gradient(135deg, ${accent1}, ${accent2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 6px 18px ${withAlpha(accent1, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
                  color: '#fff', cursor: 'pointer',
                }}>
                  {isBrowsing ? <Icons.play size={24}/> : isPlaying ? <Icons.pause size={24}/> : <Icons.play size={24}/>}
                </button>
                {tBtn(handleNext, <Icons.next size={22} stroke="var(--text-0)"/>)}
                <SecondaryBtn Icon={LoopIco} active={loopMode !== 'off'} onClick={handleLoopCycle} size={34}/>
                <SecondaryBtn Icon={Icons.queue} active={showQueue} onClick={() => setShowQueue(true)} size={34}/>
              </div>
            );
          }
          const tPrimary = (onClick: () => void, children: React.ReactNode): React.ReactElement => (
            <button onClick={onClick} style={{ width: 52, height: 52, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 26, flexShrink: 0 }}>{children}</button>
          );
          return (
            <div style={{ padding: '4px 16px 8px', transition: 'all 0.35s cubic-bezier(0.22,1,0.36,1)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
                {tPrimary(handlePrev, <Icons.prev size={28} stroke="var(--text-0)"/>)}
                <button onClick={handlePlayPause} style={{
                  width: 72, height: 72, borderRadius: 36, border: 'none', flexShrink: 0,
                  background: `linear-gradient(135deg, ${accent1}, ${accent2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 10px 28px ${withAlpha(accent1, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
                  color: '#fff', cursor: 'pointer',
                }}>
                  {isBrowsing ? <Icons.play size={30}/> : isPlaying ? <Icons.pause size={30}/> : <Icons.play size={30}/>}
                </button>
                {tPrimary(handleNext, <Icons.next size={28} stroke="var(--text-0)"/>)}
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 28px' }}>
                <SecondaryBtn Icon={ShuffleIco} active={shuffle !== ShuffleMode.Off} onClick={handleShuffle} size={36}/>
                <SecondaryBtn Icon={Icons.heartFill} active={browseTrack?.favorited ?? false} color={accent} onClick={() => browseTrack && toggleFavorite(browseTrack.hash)} size={36}/>
                <SecondaryBtn Icon={LoopIco} active={loopMode !== 'off'} onClick={handleLoopCycle} size={36}/>
                <SecondaryBtn Icon={Icons.queue} active={showQueue} onClick={() => setShowQueue(true)} size={36}/>
              </div>
            </div>
          );
        })()}

      </div>

      {/* Queue — slides to bottom:0 when nav hides so list fills the freed space */}
      {queueRecords.length > 0 && (() => {
        const queueListH = listScrolled ? `calc(${QUEUE_LIST_H}px + var(--tab-h))` : QUEUE_LIST_H;
        return (
          <div style={{
            position: 'absolute', left: 0, right: 0,
            bottom: listScrolled ? 0 : 'var(--tab-h)',
            transition: 'bottom 0.35s ease',
            zIndex: 10, background: 'var(--bg-0)', borderTop: '0.5px solid var(--border-1)',
          }}>
            {/* Queue header — drag up/down to expand/collapse; tap to toggle. */}
            <div
              onPointerDown={e => {
                queueDragStartY.current = e.clientY;
                queueDragLastY.current  = e.clientY;
                queueDragTime.current   = Date.now();
                queueVelocity.current   = 0;
                // Capture keeps move/up events routed here even if the finger leaves the header.
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                if (queueDragStartY.current === null) return;
                const now = Date.now();
                const dt  = now - queueDragTime.current;
                if (dt > 0) queueVelocity.current = (e.clientY - queueDragLastY.current) / dt * 1000;
                queueDragLastY.current = e.clientY;
                queueDragTime.current  = now;
              }}
              onPointerUp={e => {
                if (queueDragStartY.current === null) return;
                const dy = e.clientY - queueDragStartY.current;
                const v  = queueVelocity.current;
                queueDragStartY.current = null;
                if (Math.abs(dy) < 10) { handleToggleQueue(); return; }
                if ((dy < -40 || v < -300) && !queueExpanded) { setQueueExpanded(true); localStorage.setItem('mm_queue_expanded', 'true'); return; }
                if ((dy > 40 || v > 300) && queueExpanded)    { handleToggleQueue(); return; }
              }}
              onPointerCancel={() => { queueDragStartY.current = null; }}
              style={{ cursor: 'pointer', background: 'transparent', touchAction: 'none' }}
            >
              {/* Drag pill */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 0' }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-2)' }}/>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 20px 8px', gap: 12, minHeight: 36 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <Icons.stack size={14} stroke="var(--text-2)"/>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 9.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.12, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                        {queueExpanded ? 'Tracklist' : 'Up next'}
                      </span>
                      {!queueExpanded && nextTrack && (
                        <span style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {nextTrack.title}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
                      {currentPlaylist?.name ?? 'Library'} · {queueRecords.length} tracks{shuffle === ShuffleMode.Smart ? ' · smart' : shuffle === ShuffleMode.Random ? ' · random' : ''}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!queueExpanded && nextTrack && <NextTrackArt track={nextTrack}/>}
                  <div style={{ display: 'flex', transform: queueExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}>
                    <Icons.chevDown size={13} stroke="var(--text-3)"/>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ overflow: 'hidden', maxHeight: queueExpanded ? queueListH : 0, transition: 'max-height 0.4s cubic-bezier(0.22,1,0.36,1)', pointerEvents: queueExpanded ? 'auto' : 'none' }}>
              <div
                ref={listParentRef}
                onScroll={handleListScroll}
                style={{ height: queueListH, overflowY: 'auto' }}
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
              </div>
            </div>
          </div>
        );
      })()}

      <MMTabBar active="now" onTab={onTab} style={{
        transform: listScrolled ? 'translateY(var(--tab-h))' : 'translateY(0)',
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
            <MMSheet title="Queue" subtitle={shuffle !== ShuffleMode.Off ? 'Shuffle on' : undefined} height="55%" expandable animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }} onClose={() => setShowQueue(false)}>
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
                      <SwipeToRemove onRemove={() => removeUpcomingTrack(t.hash)}>
                        <QueueSheetRow track={t}/>
                      </SwipeToRemove>
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
                const isActive = b.name === playingBranchName;
                return (
                  <div
                    key={b.id}
                    onClick={async () => {
                      if (isActive) { setShowBranchSheet(false); return; }
                      setPlayingBranch(b.name);
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
                    setCurrentPlaylist(p.id); // restores browsing branch for this playlist
                    const branch = useStore.getState().currentBranchName;
                    setPlayingBranch(branch); // promote to playing branch since we're actively switching
                    try {
                      const ptracks = await invoke<PlaylistTrackRecord[]>('playlist_get_tracks', {
                        playlistId: p.id, branchName: branch,
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
