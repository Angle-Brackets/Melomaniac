import React, { useState, useRef, useEffect } from 'react';
import { ALBUMS, TRACKS } from '../data';
import { Icons } from '../icons';
import { MMArt, MMTabBar } from './common';
import type { TabId } from './common';

function MMCoverflow({ albums, activeIndex, onIndexChange, size = 200 }: {
  albums: typeof ALBUMS;
  activeIndex: number;
  onIndexChange: (i: number) => void;
  size?: number;
}) {
  const [position, setPosition] = useState(activeIndex);
  const posRef = useRef(activeIndex);
  const dragX = useRef<number | null>(null);
  const dragP = useRef(0);
  const dragging = useRef(false);
  const animFr = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging.current) animateTo(activeIndex);
  }, [activeIndex]);

  const animateTo = (t: number) => {
    if (animFr.current) cancelAnimationFrame(animFr.current);
    const s = posRef.current, d = t - s;
    if (Math.abs(d) < 0.001) { posRef.current = t; setPosition(t); return; }
    const t0 = performance.now(), dur = 360;
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      posRef.current = s + d * e;
      setPosition(s + d * e);
      if (p < 1) animFr.current = requestAnimationFrame(step);
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
    if (Math.abs(dx) > 3) dragging.current = true;
    if (!dragging.current) return;
    const w = wrapRef.current?.offsetWidth || 360;
    const raw = dragP.current - dx / (w / 2.2);
    const c = Math.max(0, Math.min(albums.length - 1, raw));
    posRef.current = c; setPosition(c);
  };
  const endDrag = () => {
    if (dragX.current === null) return;
    const was = dragging.current;
    dragX.current = null; dragging.current = false;
    if (!was) return;
    const s = Math.max(0, Math.min(albums.length - 1, Math.round(posRef.current)));
    onIndexChange(s); animateTo(s);
  };

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
      {albums.map((a, i) => {
        const off = i - position, abs = Math.abs(off);
        if (abs > 2.4) return null;
        const tx = off * (size * 0.62);
        const sc = 1 - Math.min(abs, 2) * 0.18;
        const ry = -off * 26;
        const op = Math.max(0.18, 1 - abs * 0.32);
        const tz = -Math.min(abs, 2) * 60;
        const active = abs < 0.5;
        return (
          <div key={a.id} style={{
            position: 'absolute', left: '50%', marginLeft: -size / 2,
            transform: `translateX(${tx}px) scale(${sc}) rotateY(${ry}deg) translateZ(${tz}px)`,
            opacity: op, zIndex: Math.round(10 - abs), willChange: 'transform',
          }}>
            <MMArt album={a} size={size} radius={14} glow={active}/>
          </div>
        );
      })}
    </div>
  );
}

function SecondaryBtn({ Icon, active, color = 'var(--accent)' }: {
  Icon: (p: { size?: number }) => React.ReactElement;
  active: boolean;
  color?: string;
}) {
  return (
    <button style={{
      width: 46, height: 46, borderRadius: 23,
      background: active ? `${color}1c` : 'transparent',
      border: active ? `1px solid ${color}55` : '1px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: active ? color : 'var(--text-1)',
    }}>
      <Icon size={20}/>
    </button>
  );
}

export function NowPlaying({ onTab }: { onTab: (id: TabId) => void }) {
  const [albumIndex, setAlbumIndex] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [abMode] = useState(false);
  const album = ALBUMS[albumIndex];
  const track = TRACKS.find(t => t.albumRef === albumIndex) || TRACKS[3];
  const accent = album.accent;
  const progress = 0.40;
  const abStart = 0.34, abEnd = 0.74;

  const btnStyle = (): React.CSSProperties => ({
    width: 44, height: 44, background: 'transparent', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', borderRadius: 22,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}38 0%, ${accent}10 35%, transparent 70%)`,
        filter: 'blur(20px)', pointerEvents: 'none',
      }}/>

      <div style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 22px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.chevDown size={18} stroke="var(--text-1)"/>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-2)', letterSpacing: 0.12, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>Playing from</span>
              <span style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500 }}>Study Beats</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
            <Icons.sync size={13} stroke="var(--green)"/>
            <span>synced 2m</span>
          </div>
        </div>

        <div style={{ flexShrink: 0, marginTop: 12, marginBottom: 18 }}>
          <MMCoverflow albums={ALBUMS} activeIndex={albumIndex} onIndexChange={setAlbumIndex} size={208}/>
        </div>

        <div style={{ padding: '8px 28px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>{album.title}</div>
          <div style={{ fontSize: 14, color: 'var(--text-1)', marginTop: 4 }}>{album.artist} · {track.album}</div>
          {abMode && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
              padding: '4px 10px', borderRadius: 99,
              background: `${accent}1f`, border: `1px solid ${accent}55`,
              color: accent, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.04,
            }}>
              <span style={{ fontWeight: 700 }}>A·B</span>
              <span>1:20 → 2:45</span>
              <span style={{ opacity: 0.6 }}>· 4×</span>
            </div>
          )}
        </div>

        <div style={{ padding: '22px 28px 12px' }}>
          <div style={{ position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--bg-3)', position: 'relative', overflow: 'visible' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${accent}, var(--accent-light))`, borderRadius: 2,
                boxShadow: `0 0 12px ${accent}88`,
              }}/>
              {abMode && (
                <>
                  <div style={{ position: 'absolute', left: `${abStart * 100}%`, top: '50%', width: 14, height: 14, transform: 'translate(-50%,-50%) rotate(45deg)', background: accent, borderRadius: 2, border: '1.5px solid var(--bg-1)' }}/>
                  <div style={{ position: 'absolute', left: `${abEnd * 100}%`, top: '50%', width: 14, height: 14, transform: 'translate(-50%,-50%) rotate(45deg)', background: accent, borderRadius: 2, border: '1.5px solid var(--bg-1)' }}/>
                </>
              )}
              <div style={{
                position: 'absolute', left: `${progress * 100}%`, top: '50%',
                width: 14, height: 14, transform: 'translate(-50%,-50%)',
                background: 'var(--text-0)', borderRadius: '50%',
                boxShadow: `0 0 8px ${accent}, 0 2px 6px rgba(0,0,0,0.5)`,
              }}/>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>1:30</span>
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>3:45</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 36px 4px' }}>
          <button style={btnStyle()}><Icons.prev size={26} stroke="var(--text-0)"/></button>
          <button style={btnStyle()}><Icons.skipBack size={28} stroke="var(--text-1)"/></button>
          <button onClick={() => setPlaying(p => !p)} style={{
            width: 70, height: 70, borderRadius: 35, border: 'none',
            background: `linear-gradient(135deg, var(--accent-light), ${accent})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 8px 26px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.25)`,
            color: 'var(--bg-0)', cursor: 'pointer',
          }}>
            {playing ? <Icons.pause size={28}/> : <Icons.play size={28}/>}
          </button>
          <button style={btnStyle()}><Icons.skipFwd size={28} stroke="var(--text-1)"/></button>
          <button style={btnStyle()}><Icons.next size={26} stroke="var(--text-0)"/></button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '20px 32px 8px' }}>
          <SecondaryBtn Icon={Icons.shuffle} active={false}/>
          <SecondaryBtn Icon={Icons.heartFill} active={true} color={accent}/>
          <SecondaryBtn Icon={Icons.loop} active={false}/>
          <SecondaryBtn Icon={Icons.queue} active={false}/>
        </div>

        <div style={{ flex: 1, padding: '16px 0 110px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{
            margin: '0 16px', padding: '10px 14px',
            background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
            borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 10, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Up next</div>
            <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
              <MMArt album={ALBUMS[(albumIndex + 1) % ALBUMS.length]} size={28} radius={5}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ALBUMS[(albumIndex + 1) % ALBUMS.length].title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ALBUMS[(albumIndex + 1) % ALBUMS.length].artist}</div>
              </div>
            </div>
            <Icons.chevRight size={16} stroke="var(--text-2)"/>
          </div>
        </div>
      </div>

      <MMTabBar active="now" onTab={onTab}/>
    </div>
  );
}
