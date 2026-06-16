import { useRef, useEffect, useState } from 'react';
import type { Track } from '../data';
import type { ShuffleMode } from '../types';
import {
  IcoPlay, IcoPause, IcoNext, IcoPrev,
  IcoShuffle, IcoHeart, IcoVolume, IcoLoop, IcoQueue,
} from '../icons';
import { FiLayers } from 'react-icons/fi';
import { withAlpha } from '../../shared/artworkAccents';
import { SHIMMER_DURATION, TRANSITION_FAST, TRANSITION_GLOW } from '../animations';
import ScrollText from './ScrollText';

export type LoopMode = 'off' | 'one' | 'ab';

// Pure helper — defined at module level so useEffect deps stay stable
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface PlayerControlsProps {
  track:           Track | null;
  positionMsRef:   React.MutableRefObject<number>;
  durationMs:      number;
  isPlaying:       boolean; onPlayPause: () => void;
  isFav:           boolean; onFav:       () => void;
  loopMode:        LoopMode; onLoopCycle: () => void;
  isShuffle:       boolean; shuffleMode: ShuffleMode; onShuffle: () => void;
  showQueue:       boolean; onQueueToggle: () => void;
  bigPicture:      boolean; onBigPicture: () => void;
  onSkipNext?:     () => void;
  onSkipPrev?:     () => void;
  onSeek:          (pct: number) => void;
  volume:          number;  onVolume:    (vol: number) => void;
  abA:             number;  abB:         number;
  onAbChange:      (handle: 'A' | 'B', val: number) => void;
  artworkAccents?: [string, string];
  /** False when the user has browsed to a different track than the one loaded/playing. */
  isActiveLoaded:  boolean;
}

function CtrlBtn({ active = false, onClick, title, children }: {
  active?: boolean; onClick?: () => void; title?: string; children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  const btn = (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 6, flexShrink: 0,
        background: 'none', border: 'none', cursor: 'pointer', padding: 0, outline: 'none',
        color: active ? 'var(--accent)' : hov ? 'var(--text-0)' : 'var(--text-2)',
        transition: `color ${TRANSITION_FAST}`,
      }}
    >
      {children}
    </button>
  );
  if (!title) return btn;
  return <div className="tooltip tooltip-top" data-tip={title} style={{ flexShrink: 0, display: 'flex' }}>{btn}</div>;
}

function ShuffleIcon({ isShuffle, mode, size = 16 }: { isShuffle: boolean; mode: ShuffleMode; size?: number }) {
  if (!isShuffle || mode === 'fisher-yates') return <IcoShuffle size={size} />;
  return <FiLayers size={size} />;
}

function shuffleLabel(isShuffle: boolean, mode: ShuffleMode) {
  if (!isShuffle)              return 'Shuffle: Off — click for True Shuffle';
  if (mode === 'fisher-yates') return 'True Shuffle — click for Smart';
  return 'Smart Shuffle — click to turn off';
}

function Tip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <div className="tooltip tooltip-top" data-tip={tip}>
      {children}
    </div>
  );
}

export default function PlayerControls({
  track, positionMsRef, durationMs,
  isPlaying, onPlayPause, isFav, onFav,
  loopMode, onLoopCycle, isShuffle, shuffleMode, onShuffle,
  showQueue, onQueueToggle, bigPicture, onBigPicture,
  onSkipNext, onSkipPrev,
  onSeek, volume, onVolume,
  abA, abB, onAbChange,
  artworkAccents,
  isActiveLoaded,
}: PlayerControlsProps): JSX.Element {
  const [accent1, accent2] = artworkAccents ?? ['', ''];
  const playBtnStyle = accent1 ? {
    background: accent1,
    boxShadow: `0 0 18px ${withAlpha(accent1, 0.55)}, 0 2px 8px rgba(0,0,0,0.4)`,
    border: 'none',
    color: '#fff',
  } : undefined;
  const seekFillColor = accent1
    ? `linear-gradient(90deg, ${accent1}, ${accent2 || accent1})`
    : 'var(--accent)';
  const seekRef  = useRef<HTMLDivElement>(null);
  const volRef   = useRef<HTMLDivElement>(null);
  // DOM refs for rAF-driven updates (no React re-render needed)
  const seekFillRef  = useRef<HTMLDivElement>(null);
  const seekThumbRef = useRef<HTMLDivElement>(null);
  const posTextRef   = useRef<HTMLSpanElement>(null);
  const rafRef       = useRef<number>(0);

  const seekingRef       = useRef(false);
  const volumingRef      = useRef(false);
  const abDragging       = useRef<'A' | 'B' | null>(null);
  const seekHoveredRef   = useRef(false);
  const isActiveLoadedRef = useRef(isActiveLoaded);
  const abActive         = loopMode === 'ab';

  useEffect(() => { isActiveLoadedRef.current = isActiveLoaded; }, [isActiveLoaded]);

  // rAF loop — updates seek fill and time text directly without React re-renders.
  // When the browsed track differs from the playing track, show 0 unless the
  // user hovers the seek bar (hover = peek at the live position of the playing song).
  useEffect(() => {
    const tick = () => {
      const showLive = isActiveLoadedRef.current || seekHoveredRef.current;
      const refDur   = durationMs;
      if (refDur > 0) {
        const posMs = showLive ? positionMsRef.current : 0;
        const pct   = showLive ? Math.min(1, Math.max(0, posMs / refDur)) : 0;
        if (seekFillRef.current)  seekFillRef.current.style.width = `${pct * 100}%`;
        if (seekThumbRef.current) seekThumbRef.current.style.left = `${pct * 100}%`;
        if (posTextRef.current)   posTextRef.current.textContent  = showLive ? fmtMs(posMs) : '0:00';
      } else {
        if (seekFillRef.current)  seekFillRef.current.style.width = '0%';
        if (seekThumbRef.current) seekThumbRef.current.style.left = '0%';
        if (posTextRef.current)   posTextRef.current.textContent  = '0:00';
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationMs, positionMsRef]);

  const getPct = (e: MouseEvent, ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) return 0;
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (seekingRef.current) onSeek(getPct(e, seekRef));
      if (volumingRef.current) onVolume(getPct(e, volRef));
      // 0.02 minimum gap prevents A and B from collapsing to the same point.
      if (abDragging.current === 'A') onAbChange('A', Math.min(getPct(e, seekRef), abB - 0.02));
      if (abDragging.current === 'B') onAbChange('B', Math.max(getPct(e, seekRef), abA + 0.02));
    };
    const onUp = () => { seekingRef.current = false; volumingRef.current = false; abDragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onSeek, onVolume, onAbChange, abA, abB]);

  const loopTip =
    loopMode === 'off' ? 'Loop: Off — click for Single Track' :
    loopMode === 'one' ? 'Loop: Single Track — click for A·B' :
    'Loop: A·B — drag handles on seek bar';

  return (
    <div className="shrink-0">
      {/* Track info */}
      <div className="px-5 pt-1.5 pb-0.5">
        <ScrollText
          text={track ? track.title : '—'}
          textStyle={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', textAlign: 'center', fontFamily: "'Outfit', sans-serif" }}
        />
        <ScrollText
          text={track ? `${track.artist} · ${track.album}` : 'Select a track and press play'}
          style={{ marginTop: 1 }}
          textStyle={{ fontSize: 11, color: 'var(--text-2)', textAlign: 'center', fontFamily: "'Outfit', sans-serif" }}
        />
        {abActive && durationMs > 0 && (
          <p className="font-mono text-[10px] text-mm-accent-lit mt-0.5">
            A·B Loop: {fmtMs(abA * durationMs)} → {fmtMs(abB * durationMs)}
          </p>
        )}
      </div>

      {/* Controls — left | play | right */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-1.5">
        <div className="flex items-center gap-2 justify-end">
          <CtrlBtn active={showQueue} onClick={onQueueToggle} title="Queue">
            <IcoQueue size={16} />
          </CtrlBtn>
          <CtrlBtn active={isShuffle} onClick={onShuffle} title={shuffleLabel(isShuffle, shuffleMode)}>
            <ShuffleIcon isShuffle={isShuffle} mode={shuffleMode} />
          </CtrlBtn>
          <CtrlBtn onClick={onSkipPrev} title="Previous (hold: restart track)">
            <IcoPrev size={16} />
          </CtrlBtn>
        </div>

        <Tip tip={isPlaying && isActiveLoaded ? 'Pause' : 'Play'}>
          <button
            className="btn btn-circle mx-3"
            style={{ width: 44, height: 44, minHeight: 'unset', position: 'relative', overflow: 'hidden', transition: `box-shadow ${TRANSITION_GLOW}`, ...(playBtnStyle ?? { border: '2px solid var(--border-2)', background: 'var(--bg-3)' }) }}
            onClick={onPlayPause}
          >
            {accent1 && (
              <span style={{
                position: 'absolute', left: '50%', top: '50%', width: 1000, height: 100,
                marginLeft: -500, marginTop: -50, zIndex: 0,
                background: `repeating-linear-gradient(90deg, ${accent1} 0px, ${accent2 || accent1} 50px, ${accent1} 100px)`,
                animation: `mm-play-shimmer ${SHIMMER_DURATION} linear infinite`,
                animationPlayState: isPlaying && isActiveLoaded ? 'running' : 'paused',
                pointerEvents: 'none',
              }} />
            )}
            <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isPlaying && isActiveLoaded ? <IcoPause size={18} /> : <IcoPlay size={18} />}
            </span>
          </button>
        </Tip>

        <div className="flex items-center gap-2">
          <CtrlBtn onClick={onSkipNext} title="Next">
            <IcoNext size={16} />
          </CtrlBtn>
          <CtrlBtn active={isFav} onClick={onFav} title={isFav ? 'Unfavorite' : 'Favorite'}>
            <IcoHeart size={16} />
          </CtrlBtn>
          <CtrlBtn active={loopMode !== 'off'} onClick={onLoopCycle} title={loopTip}>
            <IcoLoop mode={loopMode} />
          </CtrlBtn>
          <CtrlBtn active={bigPicture} onClick={onBigPicture} title={bigPicture ? 'Shrink artwork' : 'Expand artwork'}>
            {bigPicture
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><line x1="2" y1="5" x2="5" y2="5"/><line x1="5" y1="2" x2="5" y2="5"/><line x1="9" y1="5" x2="12" y2="5"/><line x1="9" y1="2" x2="9" y2="5"/><line x1="2" y1="9" x2="5" y2="9"/><line x1="5" y1="9" x2="5" y2="12"/><line x1="9" y1="9" x2="12" y2="9"/><line x1="9" y1="9" x2="9" y2="12"/></svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><line x1="1" y1="5" x2="1" y2="1"/><line x1="1" y1="1" x2="5" y2="1"/><line x1="9" y1="1" x2="13" y2="1"/><line x1="13" y1="1" x2="13" y2="5"/><line x1="1" y1="9" x2="1" y2="13"/><line x1="1" y1="13" x2="5" y2="13"/><line x1="9" y1="13" x2="13" y2="13"/><line x1="13" y1="9" x2="13" y2="13"/></svg>
            }
          </CtrlBtn>
        </div>
      </div>

      {/* Seek bar + volume */}
      <div className="flex items-center gap-2 px-5 pb-1.5">
        <span ref={posTextRef} className="font-mono text-[10px] text-mm-t2 min-w-[32px] text-right">
          0:00
        </span>

        {/* Custom seek bar — needed for draggable A·B loop markers */}
        <div
          className="flex-1 relative h-[18px] flex items-center cursor-pointer"
          ref={seekRef}
          onMouseEnter={() => { seekHoveredRef.current = true; }}
          onMouseLeave={() => { seekHoveredRef.current = false; }}
          onMouseDown={e => {
            if (!seekRef.current) return;
            const r = seekRef.current.getBoundingClientRect();
            const pct = (e.clientX - r.left) / r.width;
            // 4% hit-target keeps the handles pickable even at small seek-bar widths.
            if (abActive && Math.abs(pct - abA) < 0.04) abDragging.current = 'A';
            else if (abActive && Math.abs(pct - abB) < 0.04) abDragging.current = 'B';
            else { seekingRef.current = true; onSeek(pct); }
          }}
        >
          <div style={{
            position: 'absolute', left: 0, right: 0,
            top: '50%', transform: 'translateY(-50%)',
            height: 3, background: 'var(--border-1)', borderRadius: 2,
          }}>
            {abActive && (
              <div style={{
                position: 'absolute',
                left: `${abA * 100}%`, width: `${(abB - abA) * 100}%`,
                top: 0, bottom: 0, background: 'var(--accent-dim)', opacity: 0.7, borderRadius: 2,
              }} />
            )}
            <div
              ref={seekFillRef}
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: '0%',
                background: seekFillColor, borderRadius: 2,
                transition: `background-color ${TRANSITION_GLOW}`,
              }}
            />
          </div>

          <div ref={seekThumbRef} style={{
            position: 'absolute', left: '0%', top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 12, height: 12, borderRadius: '50%',
            background: 'var(--text-0)',
            boxShadow: `0 0 10px ${withAlpha(accent1 || '#ffffff', 0.7)}, 0 2px 4px rgba(0,0,0,0.5)`,
            pointerEvents: 'none', zIndex: 2,
          }} />

          {abActive && (
            <>
              <div style={{
                position: 'absolute', left: `calc(${abA * 100}% - 5px)`, top: '50%',
                transform: 'translateY(-50%)',
                width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderBottom: '9px solid var(--accent)',
                cursor: 'ew-resize', zIndex: 3,
              }} title="A — loop start" />
              <div style={{
                position: 'absolute', left: `calc(${abA * 100}% - 4px)`, top: 'calc(50% - 16px)',
                fontSize: 8, fontWeight: 700, color: 'var(--accent-light)',
                fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none', userSelect: 'none',
              }}>A</div>
              <div style={{
                position: 'absolute', left: `calc(${abB * 100}% - 5px)`, top: '50%',
                transform: 'translateY(-50%)',
                width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderBottom: '9px solid var(--accent)',
                cursor: 'ew-resize', zIndex: 3,
              }} title="B — loop end" />
              <div style={{
                position: 'absolute', left: `calc(${abB * 100}% - 4px)`, top: 'calc(50% - 16px)',
                fontSize: 8, fontWeight: 700, color: 'var(--accent-light)',
                fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none', userSelect: 'none',
              }}>B</div>
            </>
          )}
        </div>

        <span className="font-mono text-[10px] text-mm-t2 min-w-[32px]">
          {isActiveLoaded
            ? (durationMs > 0 ? fmtMs(durationMs) : '—')
            : (track?.duration_ms ? fmtMs(track.duration_ms) : '—')}
        </span>

        {/* Volume */}
        <div className="flex items-center gap-1.5 shrink-0">
          <IcoVolume size={14} className="text-mm-t2" />
          <div
            ref={volRef}
            className="w-14 h-[3px] rounded-sm cursor-pointer relative"
            style={{ background: 'var(--border-1)' }}
            onMouseDown={e => {
              if (!volRef.current) return;
              volumingRef.current = true;
              const r = volRef.current.getBoundingClientRect();
              onVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
            }}
          >
            <div className="h-full rounded-sm" style={{ width: `${volume * 100}%`, background: 'var(--text-2)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
