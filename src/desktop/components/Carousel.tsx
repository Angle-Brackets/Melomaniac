import { useState, useRef, useEffect } from 'react';
import type { Album } from '../data';

interface AlbumArtProps {
  album: Album;
  size?: number;
  style?: React.CSSProperties;
}

export function AlbumArt({ album, size = 180, style = {} }: AlbumArtProps) {
  return (
    <div className="hover-3d" style={{ width: size, height: size, flexShrink: 0 }}>
      {/* Content — receives the 3D transform from hover zones; style (e.g. boxShadow ring) goes here */}
      <div style={{
        width: size, height: size,
        borderRadius: 10,
        background: album.gradient,
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}>
        {/* grain */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")",
          opacity: 0.6, mixBlendMode: 'overlay', pointerEvents: 'none',
        }} />
        {/* bottom fade */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          pointerEvents: 'none',
        }} />
        {/* accent glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '30%',
          background: `radial-gradient(ellipse at 50% 0%, ${album.accent}44 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      </div>
      {/* 8 hover zones — DaisyUI hover-3d pattern */}
      <div /><div /><div /><div />
      <div /><div /><div /><div />
    </div>
  );
}

interface CarouselProps {
  albums: Album[];
  activeIndex: number;
  onIndexChange: (idx: number) => void;
  size?: number; // card size in px (120–240), driven by settings.carouselSize
}

const SLOT_GAP = 6; // px gap between card slots

export default function Carousel({ albums, activeIndex, onIndexChange, size = 180 }: CarouselProps) {
  const [position,      setPosition]      = useState(activeIndex);
  const [containerWidth, setContainerWidth] = useState(600);
  const posRef        = useRef(activeIndex);
  const dragStartX    = useRef<number | null>(null);
  const dragStartPos  = useRef(0);
  const isDragging    = useRef(false);
  const animFrame     = useRef<number | null>(null);
  const containerRef  = useRef<HTMLDivElement>(null);

  // Track container width so getCardProps fills the available space
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(containerRef.current);
    // Seed immediately
    setContainerWidth(containerRef.current.offsetWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isDragging.current) animateTo(activeIndex);
  }, [activeIndex]);

  const animateTo = (target: number) => {
    if (animFrame.current) cancelAnimationFrame(animFrame.current);
    const start = posRef.current;
    const dist  = target - start;
    if (Math.abs(dist) < 0.001) { posRef.current = target; setPosition(target); return; }
    const duration = 380;
    const t0 = performance.now();
    const step = (now: number) => {
      const elapsed = now - t0;
      const pct   = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - pct, 3);
      const cur   = start + dist * eased;
      posRef.current = cur;
      setPosition(cur);
      if (pct < 1) animFrame.current = requestAnimationFrame(step);
    };
    animFrame.current = requestAnimationFrame(step);
  };

  const getLiveWidth = () => containerRef.current?.offsetWidth ?? containerWidth;

  const startDrag = (clientX: number) => {
    if (animFrame.current) cancelAnimationFrame(animFrame.current);
    dragStartX.current  = clientX;
    dragStartPos.current = posRef.current;
    isDragging.current  = false;
  };

  const moveDrag = (clientX: number) => {
    if (dragStartX.current === null) return;
    const delta = clientX - dragStartX.current;
    if (Math.abs(delta) > 4) isDragging.current = true;
    if (!isDragging.current) return;
    const pxPerStep = getLiveWidth() / 2.5;
    const rawPos    = dragStartPos.current - delta / pxPerStep;
    const clamped   = Math.max(0, Math.min(albums.length - 1, rawPos));
    posRef.current  = clamped;
    setPosition(clamped);
  };

  const endDrag = () => {
    if (dragStartX.current === null) return;
    const wasDragging = isDragging.current;
    dragStartX.current = null;
    isDragging.current = false;
    if (!wasDragging) return;
    const snapped = Math.max(0, Math.min(albums.length - 1, Math.round(posRef.current)));
    onIndexChange(snapped);
    animateTo(snapped);
  };

  const snapTo = (target: number) => {
    const t = Math.max(0, Math.min(albums.length - 1, target));
    onIndexChange(t);
    animateTo(t);
  };

  // How many cards can fit on one side of centre — determines visibility cutoff
  const slot        = size + SLOT_GAP;
  const halfVisible = containerWidth / (2 * slot);

  const getCardProps = (index: number) => {
    const offset = index - position;
    const abs    = Math.abs(offset);
    if (abs > halfVisible + 0.4) return null;
    const tx      = offset * slot;
    const scale   = 1 - Math.min(abs, 2) * 0.155;
    const ry      = -offset * 22;
    const opacity = Math.max(0.18, 1 - abs * 0.28);
    const tz      = -Math.min(abs, 2) * 50;
    return {
      transform: `translateX(${tx}px) scale(${scale}) rotateY(${ry}deg) translateZ(${tz}px)`,
      opacity,
      zIndex: Math.round(10 - abs),
    };
  };

  const carouselHeight = size + 30;

  return (
    <div style={{
      position: 'relative', width: '100%', height: carouselHeight,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      willChange: 'transform', transform: 'translateZ(0)',
      contain: 'layout style paint',
    }}>
      <div
        ref={containerRef}
        onMouseDown={e => { e.preventDefault(); startDrag(e.clientX); }}
        onMouseMove={e => { if (dragStartX.current !== null) moveDrag(e.clientX); }}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={e => startDrag(e.touches[0].clientX)}
        onTouchMove={e => { e.preventDefault(); moveDrag(e.touches[0].clientX); }}
        onTouchEnd={() => endDrag()}
        style={{
          position: 'relative', width: '100%', height: '100%',
          perspective: '1100px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'pan-y',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        {albums.map((album, i) => {
          const props = getCardProps(i);
          if (!props) return null;
          const isActive = Math.abs(i - position) < 0.5;
          return (
            <div
              key={i}
              onClick={() => { if (!isDragging.current) snapTo(i); }}
              style={{
                position: 'absolute', left: '50%', marginLeft: -(size / 2),
                cursor: 'pointer', willChange: 'transform',
                backfaceVisibility: 'hidden',
                ...props,
              }}
            >
              <AlbumArt album={album} size={size} style={{
                boxShadow: isActive
                  ? `0 8px 36px rgba(0,0,0,0.7), 0 0 0 2px var(--accent), 0 0 24px ${album.accent}44`
                  : '0 4px 16px rgba(0,0,0,0.5)',
              }} />
            </div>
          );
        })}
      </div>

      <button onClick={() => snapTo(Math.round(posRef.current) - 1)} style={{
        position: 'absolute', left: 20, zIndex: 20,
        width: 28, height: 28, borderRadius: '50%',
        border: '1px solid var(--border-2)', background: 'var(--bg-3)', color: 'var(--text-1)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, transition: 'all 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; }}
      >‹</button>
      <button onClick={() => snapTo(Math.round(posRef.current) + 1)} style={{
        position: 'absolute', right: 20, zIndex: 20,
        width: 28, height: 28, borderRadius: '50%',
        border: '1px solid var(--border-2)', background: 'var(--bg-3)', color: 'var(--text-1)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, transition: 'all 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; }}
      >›</button>
    </div>
  );
}
