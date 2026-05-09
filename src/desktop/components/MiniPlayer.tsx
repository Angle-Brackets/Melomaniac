import { useRef, useEffect } from 'react';
import type { Track } from '../data';
import type { LoopMode } from './PlayerControls';
import { IcoPlay, IcoPause, IcoNext, IcoPrev, IcoVolume, IcoLoop } from '../icons';

interface MiniPlayerProps {
  track:       Track | null;
  artworkUrl?: string;
  isPlaying:   boolean;
  positionMs:  number;
  durationMs:  number;
  loopMode:    LoopMode;
  volume:      number;
  onPlayPause: () => void;
  onSkipNext:  () => void;
  onSkipPrev:  () => void;
  onLoopCycle: () => void;
  onSeek:      (pct: number) => void;
  onVolume:    (vol: number) => void;
  onCollapse:  () => void;
  onStop:      () => void;
}

export default function MiniPlayer({
  track, artworkUrl, isPlaying, positionMs, durationMs,
  loopMode, volume, onPlayPause, onSkipNext, onSkipPrev,
  onLoopCycle, onSeek, onVolume, onCollapse, onStop,
}: MiniPlayerProps) {
  const seekPct   = durationMs > 0 ? positionMs / durationMs : 0;
  const seekRef   = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!seekingRef.current || !seekRef.current) return;
      const r = seekRef.current.getBoundingClientRect();
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
        ref={seekRef}
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
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${seekPct * 100}%`,
          background: 'var(--accent)',
          transition: 'width 0.25s linear',
          borderRadius: '0 2px 2px 0',
        }} />
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
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-0)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: "'Outfit', sans-serif",
            }}>
              {track?.title ?? '—'}
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-2)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: "'Outfit', sans-serif",
            }}>
              {track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : ''}
            </div>
          </div>
        </div>

        {/* Center — transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="btn btn-ghost btn-square btn-sm" onClick={onSkipPrev} title="Previous">
            <IcoPrev size={15} />
          </button>
          <button
            className="btn btn-ghost btn-circle border border-mm-b2"
            style={{ width: 36, height: 36, minHeight: 'unset' }}
            onClick={onPlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <IcoPause size={15} /> : <IcoPlay size={15} />}
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={onSkipNext} title="Next">
            <IcoNext size={15} />
          </button>
        </div>

        {/* Right — loop + volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          <button
            className={`btn btn-ghost btn-square btn-sm ${loopMode !== 'off' ? 'text-primary' : ''}`}
            onClick={onLoopCycle}
            title={loopTitle}
          >
            <IcoLoop mode={loopMode} />
          </button>
          <IcoVolume size={13} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
          <input
            type="range" min={0} max={1} step={0.01}
            value={volume}
            onChange={e => onVolume(Number(e.target.value))}
            className="range range-xs range-primary"
            style={{ width: 88 }}
          />
          <button
            className="btn btn-ghost btn-square btn-xs"
            onClick={onCollapse}
            title="Collapse player"
            style={{ color: 'var(--text-3)', marginLeft: 2 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="2,3.5 5,6.5 8,3.5" />
            </svg>
          </button>
          <button
            className="btn btn-ghost btn-square btn-xs"
            onClick={onStop}
            title="Stop and dismiss"
            style={{ color: 'var(--text-3)' }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="2" y1="2" x2="8" y2="8" />
              <line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}
