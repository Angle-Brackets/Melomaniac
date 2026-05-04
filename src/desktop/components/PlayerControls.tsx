import { useRef, useEffect } from 'react';
import type { Track } from '../data';
import {
  IcoPlay, IcoPause, IcoNext, IcoPrev,
  IcoShuffle, IcoHeart, IcoVolume, IcoLoop, IcoQueue,
} from '../icons';

export type LoopMode = 'off' | 'one' | 'ab';

interface PlayerControlsProps {
  track:       Track | null;
  positionMs:  number;
  durationMs:  number;
  isPlaying:   boolean; onPlayPause: () => void;
  isFav:       boolean; onFav:       () => void;
  loopMode:    LoopMode; onLoopCycle: () => void;
  isShuffle:   boolean; onShuffle:   () => void;
  onSeek:      (pct: number) => void;
  volume:      number;  onVolume:    (vol: number) => void;
  abA:         number;  abB:         number;
  onAbChange:  (handle: 'A' | 'B', val: number) => void;
}

export default function PlayerControls({
  track, positionMs, durationMs,
  isPlaying, onPlayPause, isFav, onFav,
  loopMode, onLoopCycle, isShuffle, onShuffle,
  onSeek, volume, onVolume,
  abA, abB, onAbChange,
}: PlayerControlsProps) {
  const seekPct = durationMs > 0 ? positionMs / durationMs : 0;
  const seekRef  = useRef<HTMLDivElement>(null);
  const volRef   = useRef<HTMLDivElement>(null);
  const seekingRef  = useRef(false);
  const volumingRef = useRef(false);
  const abDragging  = useRef<'A' | 'B' | null>(null);
  const abActive    = loopMode === 'ab';

  const getPct = (e: MouseEvent, ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) return 0;
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (seekingRef.current) onSeek(getPct(e, seekRef));
      if (volumingRef.current) onVolume(getPct(e, volRef));
      if (abDragging.current === 'A') onAbChange('A', Math.min(getPct(e, seekRef), abB - 0.02));
      if (abDragging.current === 'B') onAbChange('B', Math.max(getPct(e, seekRef), abA + 0.02));
    };
    const onUp = () => { seekingRef.current = false; volumingRef.current = false; abDragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onSeek, onVolume, onAbChange, abA, abB]);

  const loopTitle =
    loopMode === 'off' ? 'Loop: Off — click for Single Song loop' :
    loopMode === 'one' ? 'Loop: Single Song — click for A·B loop' :
    'Loop: A·B — drag handles on seek bar · click to disable';

  const fmtMs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

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
          <button className="btn btn-ghost btn-square btn-sm" title="Queue"><IcoQueue size={16} /></button>
          <button
            className={`btn btn-ghost btn-square btn-sm ${isShuffle ? 'text-primary' : ''}`}
            onClick={onShuffle} title="Shuffle"
          ><IcoShuffle size={16} /></button>
          <button className="btn btn-ghost btn-square btn-sm" title="Previous"><IcoPrev size={16} /></button>
        </div>

        {/* Play/pause — explicit 44px circle so DaisyUI size classes don't squash it */}
        <button
          className="btn btn-ghost btn-circle mx-3 border-2 border-mm-b2 bg-mm-3"
          style={{ width: 44, height: 44, minHeight: 'unset' }}
          onClick={onPlayPause} title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <IcoPause size={18} /> : <IcoPlay size={18} />}
        </button>

        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-square btn-sm" title="Next"><IcoNext size={16} /></button>
          <button
            className={`btn btn-ghost btn-square btn-sm ${isFav ? 'text-primary' : ''}`}
            onClick={onFav} title="Favorite"
          ><IcoHeart size={16} /></button>
          <button
            className={`btn btn-ghost btn-square btn-sm ${loopMode !== 'off' ? 'text-primary' : ''}`}
            onClick={onLoopCycle} title={loopTitle}
          ><IcoLoop mode={loopMode} /></button>
        </div>
      </div>

      {/* Seek bar + volume */}
      <div className="flex items-center gap-2 px-5 pb-1.5">
        <span className="font-mono text-[10px] text-mm-t2 min-w-[32px] text-right">
          {fmtMs(positionMs)}
        </span>

        {/* Custom seek bar — needed for draggable A·B loop markers */}
        <div
          className="flex-1 relative h-[18px] flex items-center cursor-pointer"
          ref={seekRef}
          onMouseDown={e => {
            if (!seekRef.current) return;
            const r = seekRef.current.getBoundingClientRect();
            const pct = (e.clientX - r.left) / r.width;
            if (abActive && Math.abs(pct - abA) < 0.04) abDragging.current = 'A';
            else if (abActive && Math.abs(pct - abB) < 0.04) abDragging.current = 'B';
            else { seekingRef.current = true; onSeek(pct); }
          }}
        >
          {/* Inline styles only — avoid Tailwind-v4 cascade overriding position */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            top: '50%', transform: 'translateY(-50%)',
            height: 3, background: 'var(--border-1)', borderRadius: 2,
            transition: 'height 0.12s',
          }}>
            {abActive && (
              <div style={{
                position: 'absolute',
                left: `${abA * 100}%`, width: `${(abB - abA) * 100}%`,
                top: 0, bottom: 0, background: 'var(--accent-dim)', opacity: 0.7, borderRadius: 2,
              }} />
            )}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${seekPct * 100}%`,
              background: 'var(--accent)', borderRadius: 2,
            }} />
          </div>

          {abActive && (
            <>
              {/* A handle */}
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
              {/* B handle */}
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
