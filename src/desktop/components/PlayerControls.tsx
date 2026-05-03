import { useRef, useEffect } from 'react';
import { TRACKS } from '../data';

export type LoopMode = 'off' | 'one' | 'ab';

interface PlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  isFav: boolean;
  onFav: () => void;
  loopMode: LoopMode;
  onLoopCycle: () => void;
  isShuffle: boolean;
  onShuffle: () => void;
  seekPct: number;
  onSeek: (pct: number) => void;
  volume: number;
  onVolume: (vol: number) => void;
  abA: number;
  abB: number;
  onAbChange: (handle: 'A' | 'B', val: number) => void;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Ico = {
  shuffle: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h8a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H2"/><path d="M2 12h2.5"/><path d="M11 2l3 2-3 2"/><path d="M11 10l3 2-3 2"/><path d="M2 4h2.5"/></svg>,
  prev:    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3h1.5v10H4zM5.5 8L13 3v10z"/></svg>,
  next:    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12 3h-1.5v10H12zM10.5 8L3 13V3z"/></svg>,
  play:    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l10 5.5-10 5.5z"/></svg>,
  pause:   <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>,
  heart:   (filled: boolean) => <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "currentColor"} strokeWidth="1.5"><path d="M8 13.5S2 9.5 2 5.5a3.5 3.5 0 0 1 6-2.45A3.5 3.5 0 0 1 14 5.5c0 4-6 8-6 8z"/></svg>,
  vol:     <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 5h2l3-3v10L4 9H2V5z"/><path d="M9.5 4.5a3 3 0 0 1 0 5"/><path d="M11 3a5 5 0 0 1 0 8"/></svg>,
};

function LoopIcon({ mode }: { mode: LoopMode }) {
  if (mode === 'off') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h8v3l3-3-3-3v3"/><path d="M12 12H4V9l-3 3 3 3v-3"/>
    </svg>
  );
  if (mode === 'one') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h8v3l3-3-3-3v3"/><path d="M12 12H4V9l-3 3 3 3v-3"/>
      <text x="6.5" y="10.5" fontSize="6" fontWeight="900" fill="currentColor" stroke="none" fontFamily="monospace">1</text>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <text x="1.5" y="11.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="monospace">A</text>
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.5 1.5"/>
      <text x="9.5" y="11.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="monospace">B</text>
    </svg>
  );
}

export default function PlayerControls({
  isPlaying, onPlayPause, isFav, onFav,
  loopMode, onLoopCycle, isShuffle, onShuffle,
  seekPct, onSeek, volume, onVolume,
  abA, abB, onAbChange,
}: PlayerControlsProps) {
  const track = TRACKS[0];
  const seekRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);
  const volumingRef = useRef(false);
  const abDragging = useRef<'A' | 'B' | null>(null);
  const abActive = loopMode === 'ab';

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

  const loopTitle = loopMode === 'off'
    ? 'Loop: Off — click for Single Song loop'
    : loopMode === 'one'
    ? 'Loop: Single Song — click for A·B loop'
    : 'Loop: A·B — drag handles on seek bar · click to disable';

  const timeStr = (pct: number) => {
    const total = 24 * 60;
    const secs = Math.floor(pct * total);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };

  return (
    <div style={{ flexShrink: 0 }}>
      {/* track info */}
      <div style={{ textAlign: 'center', padding: '6px 20px 2px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Track: {track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 1 }}>
          Artist: {track.artist} &nbsp;·&nbsp; Album: {track.album}
        </div>
        {abActive && (
          <div style={{ fontSize: 10, color: 'var(--accent-light)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
            A·B Loop: {(abA * 24).toFixed(1)}min → {(abB * 24).toFixed(1)}min
          </div>
        )}
      </div>

      {/* controls — left | center | right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '6px 24px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <button className={`ctrl-btn${isShuffle ? ' active' : ''}`} onClick={onShuffle} title="Shuffle">{Ico.shuffle}</button>
          <button className="ctrl-btn" title="Previous">{Ico.prev}</button>
        </div>
        <button className="ctrl-btn large" onClick={onPlayPause} title={isPlaying ? 'Pause' : 'Play'} style={{ margin: '0 14px' }}>
          {isPlaying ? Ico.pause : Ico.play}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
          <button className="ctrl-btn" title="Next">{Ico.next}</button>
          <button className={`ctrl-btn${isFav ? ' active' : ''}`} onClick={onFav} title="Favorite">{Ico.heart(isFav)}</button>
          <button
            className={`ctrl-btn${loopMode !== 'off' ? ' active' : ''}`}
            onClick={onLoopCycle}
            title={loopTitle}
            style={{ transition: 'color 0.2s, background 0.2s' }}
          ><LoopIcon mode={loopMode} /></button>
        </div>
      </div>

      {/* seek + volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 20px 6px' }}>
        <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", minWidth: 32, textAlign: 'right' }}>
          {timeStr(seekPct)}
        </span>

        {/* seek bar */}
        <div style={{ flex: 1, position: 'relative', height: 18, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          ref={seekRef}
          onMouseDown={e => {
            if (!seekRef.current) return;
            const r = seekRef.current.getBoundingClientRect();
            const pct = (e.clientX - r.left) / r.width;
            const distA = Math.abs(pct - abA);
            const distB = Math.abs(pct - abB);
            if (abActive && distA < 0.04) abDragging.current = 'A';
            else if (abActive && distB < 0.04) abDragging.current = 'B';
            else { seekingRef.current = true; onSeek(pct); }
          }}
        >
          <div className="seek-track" style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 3, margin: 0 }}>
            {abActive && (
              <div style={{
                position: 'absolute',
                left: `${abA * 100}%`, width: `${(abB - abA) * 100}%`,
                height: '100%', background: 'var(--accent-dim)', opacity: 0.7, borderRadius: 2,
              }} />
            )}
            <div className="seek-fill" style={{ width: `${seekPct * 100}%` }} />
          </div>

          {abActive && (
            <>
              <div style={{
                position: 'absolute', left: `calc(${abA * 100}% - 5px)`, top: '50%', transform: 'translateY(-50%)',
                width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderBottom: '9px solid var(--accent)',
                cursor: 'ew-resize', zIndex: 3, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
              }} title="A — loop start (drag)" />
              <div style={{
                position: 'absolute', left: `calc(${abA * 100}% - 4px)`, top: 'calc(50% - 16px)',
                fontSize: 8, fontWeight: 700, color: 'var(--accent-light)',
                fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none', userSelect: 'none',
              }}>A</div>
              <div style={{
                position: 'absolute', left: `calc(${abB * 100}% - 5px)`, top: '50%', transform: 'translateY(-50%)',
                width: 0, height: 0,
                borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                borderBottom: '9px solid var(--accent)',
                cursor: 'ew-resize', zIndex: 3, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
              }} title="B — loop end (drag)" />
              <div style={{
                position: 'absolute', left: `calc(${abB * 100}% - 4px)`, top: 'calc(50% - 16px)',
                fontSize: 8, fontWeight: 700, color: 'var(--accent-light)',
                fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none', userSelect: 'none',
              }}>B</div>
            </>
          )}
        </div>

        <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", minWidth: 32 }}>24:20</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{Ico.vol}</span>
          <div ref={volRef} style={{ width: 60, height: 3, background: 'var(--border-1)', borderRadius: 2, cursor: 'pointer', position: 'relative' }}
            onMouseDown={e => {
              if (!volRef.current) return;
              volumingRef.current = true;
              const r = volRef.current.getBoundingClientRect();
              onVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
            }}>
            <div style={{ height: '100%', width: `${volume * 100}%`, background: 'var(--text-2)', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
