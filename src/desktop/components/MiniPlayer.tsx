import { useRef, useEffect, useState } from 'react';
import type { Track } from '../data';
import type { LoopMode } from './PlayerControls';
import { IcoPlay, IcoPause, IcoNext, IcoPrev, IcoVolume, IcoLoop, IcoQueue } from '../icons';
import ScrollText from './ScrollText';

// Size of the small action buttons (collapse ↓, stop ×) — increase to grow hit target
const MINI_BTN_SIZE = 28;

function MiniBtn({ active = false, onClick, title, children }: {
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
        width: MINI_BTN_SIZE, height: MINI_BTN_SIZE, borderRadius: 5, flexShrink: 0,
        background: 'none', border: 'none', cursor: 'pointer', padding: 0, outline: 'none',
        color: active ? 'var(--accent)' : hov ? 'var(--text-0)' : 'var(--text-2)',
        transition: 'color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
  if (!title) return btn;
  return <div className="tooltip tooltip-top" data-tip={title} style={{ flexShrink: 0, display: 'flex' }}>{btn}</div>;
}

interface MiniPlayerProps {
  track:         Track | null;
  artworkUrl?:   string;
  isPlaying:     boolean;
  positionMsRef: React.MutableRefObject<number>;
  durationMs:    number;
  loopMode:      LoopMode;
  abA:           number;
  abB:           number;
  volume:        number;
  onPlayPause:   () => void;
  onSkipNext:    () => void;
  onSkipPrev:    () => void;
  onLoopCycle:   () => void;
  onSeek:        (pct: number) => void;
  onVolume:      (vol: number) => void;
  showQueue:      boolean;
  onQueueToggle:  () => void;
  onCollapse:     () => void;
  onStop:         () => void;
  artworkAccents?: [string, string];
}

export default function MiniPlayer({
  track, artworkUrl, isPlaying, positionMsRef, durationMs,
  loopMode, abA, abB, volume, onPlayPause, onSkipNext, onSkipPrev,
  onLoopCycle, onSeek, onVolume, showQueue, onQueueToggle, onCollapse, onStop,
  artworkAccents,
}: MiniPlayerProps): JSX.Element {
  const [accent1, accent2] = artworkAccents ?? ['', ''];
  const seekFillStyle = accent1
    ? `linear-gradient(90deg, ${accent1}, ${accent2 || accent1})`
    : 'var(--accent)';
  const seekBarRef  = useRef<HTMLDivElement>(null);
  const seekFillRef = useRef<HTMLDivElement>(null);
  const seekingRef  = useRef(false);
  const rafRef      = useRef<number>(0);

  // rAF loop — updates seek fill width without React re-renders
  useEffect(() => {
    const tick = () => {
      if (durationMs > 0 && seekFillRef.current) {
        const pct = Math.min(1, Math.max(0, positionMsRef.current / durationMs));
        seekFillRef.current.style.width = `${pct * 100}%`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationMs, positionMsRef]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!seekingRef.current || !seekBarRef.current) return;
      const r = seekBarRef.current.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    };
    const onUp = () => { seekingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onSeek]);

  const loopTitle =
    loopMode === 'off' ? 'Loop off' :
    loopMode === 'one' ? 'Loop: one track' : 'Loop: A·B';

  return (
    <div style={{
      height: 62, flexShrink: 0,
      background: 'var(--bg-1)',
      borderTop: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* Seek bar — 3px strip at very top, draggable */}
      <div
        ref={seekBarRef}
        style={{
          height: 3, flexShrink: 0, cursor: 'pointer', position: 'relative',
          background: 'var(--border-0)',
        }}
        onMouseDown={e => {
          seekingRef.current = true;
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }}
      >
        <div
          ref={seekFillRef}
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: '0%',
            background: seekFillStyle,
            borderRadius: '0 2px 2px 0',
          }}
        />
        {loopMode === 'ab' && (
          <>
            <svg width="7" height="7" viewBox="0 0 7 7" style={{
              position: 'absolute', top: '50%', left: `${abA * 100}%`,
              transform: 'translate(-50%, -50%)',
              overflow: 'visible', pointerEvents: 'none',
            }}>
              <polygon points="3.5,0 7,3.5 3.5,7 0,3.5" fill="var(--accent-light)" opacity="0.9" />
            </svg>
            <svg width="7" height="7" viewBox="0 0 7 7" style={{
              position: 'absolute', top: '50%', left: `${abB * 100}%`,
              transform: 'translate(-50%, -50%)',
              overflow: 'visible', pointerEvents: 'none',
            }}>
              <polygon points="3.5,0 7,3.5 3.5,7 0,3.5" fill="var(--accent-light)" opacity="0.9" />
            </svg>
          </>
        )}
      </div>

      {/* Controls row */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: '0 14px',
        gap: 8,
      }}>

        {/* Left — artwork + track info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 5, flexShrink: 0,
            background: artworkUrl
              ? `url(${artworkUrl}) center/cover no-repeat, var(--bg-4)`
              : 'var(--bg-4)',
            border: '1px solid var(--border-1)',
          }} />
          <div style={{ minWidth: 0 }}>
            <ScrollText
              text={track?.title ?? '—'}
              textStyle={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}
            />
            <ScrollText
              text={track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : ''}
              style={{ marginTop: 1 }}
              textStyle={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif" }}
            />
          </div>
        </div>

        {/* Center — transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <MiniBtn onClick={onSkipPrev} title="Previous"><IcoPrev size={15} /></MiniBtn>
          <button
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 18, flexShrink: 0,
              background: 'none', border: '1.5px solid var(--border-2)',
              cursor: 'pointer', color: 'var(--text-0)', outline: 'none',
            }}
            onClick={onPlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <IcoPause size={15} /> : <IcoPlay size={15} />}
          </button>
          <MiniBtn onClick={onSkipNext} title="Next"><IcoNext size={15} /></MiniBtn>
        </div>

        {/* Right — queue + loop + volume + collapse + stop */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <MiniBtn active={showQueue} onClick={onQueueToggle} title="Queue">
            <IcoQueue size={14} />
          </MiniBtn>
          <MiniBtn active={loopMode !== 'off'} onClick={onLoopCycle} title={loopTitle}>
            <IcoLoop mode={loopMode} />
          </MiniBtn>
          <IcoVolume size={13} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
          <input
            type="range" min={0} max={1} step={0.01}
            value={volume}
            onChange={e => onVolume(Number(e.target.value))}
            className="range range-xs range-primary"
            style={{ width: 88 }}
          />
          <MiniBtn onClick={onCollapse} title="Collapse player">
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,1 5,5 9,1" />
            </svg>
          </MiniBtn>
          <MiniBtn onClick={onStop} title="Stop and dismiss">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8" />
              <line x1="8" y1="1" x2="1" y2="8" />
            </svg>
          </MiniBtn>
        </div>

      </div>
    </div>
  );
}
