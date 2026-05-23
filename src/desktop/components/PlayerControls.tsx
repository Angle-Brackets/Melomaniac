import { useRef, useEffect } from 'react';
import type { Track } from '../data';
import type { ShuffleMode } from '../types';
import {
  IcoPlay, IcoPause, IcoNext, IcoPrev,
  IcoShuffle, IcoHeart, IcoVolume, IcoLoop, IcoQueue, IcoDice,
} from '../icons';
import { FiLayers } from 'react-icons/fi';

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
  onSkipNext?:     () => void;
  onSkipPrev?:     () => void;
  onSeek:          (pct: number) => void;
  volume:          number;  onVolume:    (vol: number) => void;
  abA:             number;  abB:         number;
  onAbChange:      (handle: 'A' | 'B', val: number) => void;
}

function ShuffleIcon({ isShuffle, mode, size = 16 }: { isShuffle: boolean; mode: ShuffleMode; size?: number }) {
  if (!isShuffle || mode === 'fisher-yates') return <IcoShuffle size={size} />;
  if (mode === 'balanced') return <FiLayers size={size} />;
  return <IcoDice size={size} />;
}

function shuffleLabel(isShuffle: boolean, mode: ShuffleMode) {
  if (!isShuffle)              return 'Shuffle: Off — click for True Shuffle';
  if (mode === 'fisher-yates') return 'True Shuffle — click for Balanced';
  if (mode === 'balanced')     return 'Balanced Shuffle — click for Random';
  return 'Random — click to turn off';
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
  showQueue, onQueueToggle,
  onSkipNext, onSkipPrev,
  onSeek, volume, onVolume,
  abA, abB, onAbChange,
}: PlayerControlsProps): JSX.Element {
  const seekRef  = useRef<HTMLDivElement>(null);
  const volRef   = useRef<HTMLDivElement>(null);
  // DOM refs for rAF-driven updates (no React re-render needed)
  const seekFillRef = useRef<HTMLDivElement>(null);
  const posTextRef  = useRef<HTMLSpanElement>(null);
  const rafRef      = useRef<number>(0);

  const seekingRef  = useRef(false);
  const volumingRef = useRef(false);
  const abDragging  = useRef<'A' | 'B' | null>(null);
  const abActive    = loopMode === 'ab';

  // rAF loop — updates seek fill and time text directly without React re-renders
  useEffect(() => {
    const tick = () => {
      if (durationMs > 0) {
        const posMs = positionMsRef.current;
        const pct = Math.min(1, Math.max(0, posMs / durationMs));
        if (seekFillRef.current) seekFillRef.current.style.width = `${pct * 100}%`;
        if (posTextRef.current)  posTextRef.current.textContent  = fmtMs(posMs);
      } else {
        if (seekFillRef.current) seekFillRef.current.style.width = '0%';
        if (posTextRef.current)  posTextRef.current.textContent  = '0:00';
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
      <div className="text-center px-5 pt-1.5 pb-0.5">
        <p className="text-[13px] font-semibold text-mm-t0">
          {track ? track.title : '—'}
        </p>
        <p className="text-[11px] text-mm-t2 mt-px">
          {track ? `${track.artist} · ${track.album}` : 'Select a track and press play'}
        </p>
        {abActive && durationMs > 0 && (
          <p className="font-mono text-[10px] text-mm-accent-lit mt-0.5">
            A·B Loop: {fmtMs(abA * durationMs)} → {fmtMs(abB * durationMs)}
          </p>
        )}
      </div>

      {/* Controls — left | play | right */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-1.5">
        <div className="flex items-center gap-2 justify-end">
          <Tip tip="Queue">
            <button
              className={`btn btn-ghost btn-square btn-sm ${showQueue ? 'text-primary' : ''}`}
              onClick={onQueueToggle}
            ><IcoQueue size={16} /></button>
          </Tip>
          <Tip tip={shuffleLabel(isShuffle, shuffleMode)}>
            <button
              className={`btn btn-ghost btn-square btn-sm ${isShuffle ? 'text-primary' : ''}`}
              onClick={onShuffle}
            >
              <ShuffleIcon isShuffle={isShuffle} mode={shuffleMode} />
            </button>
          </Tip>
          <Tip tip="Previous (hold: restart track)">
            <button className="btn btn-ghost btn-square btn-sm" onClick={onSkipPrev}><IcoPrev size={16} /></button>
          </Tip>
        </div>

        <Tip tip={isPlaying ? 'Pause' : 'Play'}>
          <button
            className="btn btn-ghost btn-circle mx-3 border-2 border-mm-b2 bg-mm-3"
            style={{ width: 44, height: 44, minHeight: 'unset' }}
            onClick={onPlayPause}
          >
            {isPlaying ? <IcoPause size={18} /> : <IcoPlay size={18} />}
          </button>
        </Tip>

        <div className="flex items-center gap-2">
          <Tip tip="Next">
            <button className="btn btn-ghost btn-square btn-sm" onClick={onSkipNext}><IcoNext size={16} /></button>
          </Tip>
          <Tip tip={isFav ? 'Unfavorite' : 'Favorite'}>
            <button
              className={`btn btn-ghost btn-square btn-sm ${isFav ? 'text-primary' : ''}`}
              onClick={onFav}
            ><IcoHeart size={16} /></button>
          </Tip>
          <Tip tip={loopTip}>
            <button
              className={`btn btn-ghost btn-square btn-sm ${loopMode !== 'off' ? 'text-primary' : ''}`}
              onClick={onLoopCycle}
            ><IcoLoop mode={loopMode} /></button>
          </Tip>
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
                background: 'var(--accent)', borderRadius: 2,
              }}
            />
          </div>

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
          {durationMs > 0 ? fmtMs(durationMs) : '—'}
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
