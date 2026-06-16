import { useState, useRef, useEffect } from 'react';
import type { Album } from '../data';
import { withAlpha } from '../../shared/artworkAccents';

interface AlbumArtProps {
  album: Album;
  size?: number;
  style?: React.CSSProperties;
  tilt?: boolean;
}

export function AlbumArt({ album, size = 180, style = {}, tilt = true }: AlbumArtProps) {
  const inner = (
    <div style={{
        width: size, height: size,
        borderRadius: 10,
        background: album.artworkUrl
          ? `url(${album.artworkUrl}) center/cover no-repeat, ${album.gradient}`
          : album.gradient,
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
  );
  if (!tilt) return inner;
  return (
    <div className="hover-3d" style={{ width: size, height: size, flexShrink: 0 }}>
      {inner}
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
  activeGlowColors?: [string, string];
  bigPicture?: boolean;
  privacyMode?: boolean;
}

const SLOT_GAP = 6; // px gap between card slots

export default function Carousel({ albums, activeIndex, onIndexChange, size = 180, activeGlowColors, bigPicture, privacyMode }: CarouselProps) {
  const [position,       setPosition]       = useState(activeIndex);
  const [containerWidth, setContainerWidth]  = useState(600);
  const [containerHeight, setContainerHeight] = useState(0);
  const posRef           = useRef(activeIndex);
  const dragStartX       = useRef<number | null>(null);
  const dragStartPos     = useRef(0);
  const isDragging       = useRef(false);
  const animFrame        = useRef<number | null>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const wheelVelRef      = useRef(0);
  const wheelRafRef      = useRef<number | null>(null);
  const albumsLenRef     = useRef(albums.length);
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => { albumsLenRef.current     = albums.length;  }, [albums.length]);
  useEffect(() => { onIndexChangeRef.current = onIndexChange;  }, [onIndexChange]);

  // Track container dimensions so getCardProps fills the available space
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(containerRef.current);
    setContainerWidth(containerRef.current.offsetWidth);
    setContainerHeight(containerRef.current.offsetHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isDragging.current) animateTo(activeIndex);
  }, [activeIndex]);

  // Wheel with momentum — passive:false so preventDefault stops page scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Normalize: mouse notch ≈ 120, trackpad per-event ≈ 1–10
      const delta = e.deltaY * 0.0015;
      wheelVelRef.current = Math.max(-3, Math.min(3, wheelVelRef.current + delta));

      if (wheelRafRef.current !== null) return; // loop already running

      // Cancel any in-progress animateTo
      if (animFrame.current) { cancelAnimationFrame(animFrame.current); animFrame.current = null; }

      const tick = () => {
        const vel = wheelVelRef.current;
        if (Math.abs(vel) < 0.005) {
          wheelVelRef.current = 0;
          wheelRafRef.current = null;
          const snapped = Math.max(0, Math.min(albumsLenRef.current - 1, Math.round(posRef.current)));
          onIndexChangeRef.current(snapped);
          animateTo(snapped);
          return;
        }
        const newPos = Math.max(0, Math.min(albumsLenRef.current - 1, posRef.current + vel));
        posRef.current = newPos;
        setPosition(newPos);
        wheelVelRef.current *= 0.87;
        wheelRafRef.current = requestAnimationFrame(tick);
      };

      wheelRafRef.current = requestAnimationFrame(tick);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current) { cancelAnimationFrame(wheelRafRef.current); wheelRafRef.current = null; }
      wheelVelRef.current = 0;
    };
  }, []);

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

  // In Big Picture mode, cards scale to fill ~72% of the container height
  const effectiveSize = bigPicture && containerHeight > 80
    ? Math.min(Math.floor(containerHeight * 0.72), 380)
    : size;
  const slot        = effectiveSize + SLOT_GAP;
  const halfVisible = containerWidth / (2 * slot);

  const getCardProps = (index: number) => {
    const offset = index - position;
    const abs    = Math.abs(offset);
    // +0.4 margin prevents a card from popping out when it's almost entirely off-screen
    if (abs > halfVisible + 0.4) return null;
    const tx      = offset * slot;
    const scale   = 1 - Math.min(abs, 2) * 0.19;
    const opacity = Math.max(0.18, 1 - abs * 0.28);
    const tz      = -Math.min(abs, 2) * 50;
    return {
      transform: `translateX(${tx}px) scale(${scale}) translateZ(${tz}px)`,
      opacity,
      zIndex: Math.round(10 - abs),
      tilt: abs <= 1,
    };
  };

  const carouselHeight = bigPicture ? '100%' : (size + 30);

  return (
    <div style={{
      position: 'relative', width: '100%',
      height: carouselHeight, flex: bigPicture ? 1 : undefined, minHeight: bigPicture ? 0 : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      willChange: 'transform', transform: 'translateZ(0)',
      contain: 'layout style paint',
      transition: 'height 0.22s ease',
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
          const { tilt, ...cardStyle } = props;
          const glowColor = isActive && activeGlowColors ? activeGlowColors[0] : album.accent;
          return (
            <div
              key={i}
              onClick={() => { if (!isDragging.current) snapTo(i); }}
              style={{
                position: 'absolute', left: '50%', marginLeft: -(effectiveSize / 2),
                cursor: 'pointer', willChange: 'transform',
                borderRadius: 12,
                ...cardStyle,
              }}
            >
              <div style={{ position: 'relative' }}>
                <AlbumArt album={album} size={effectiveSize} tilt={tilt} style={{
                  boxShadow: isActive
                    ? `0 8px 36px rgba(0,0,0,0.7), 0 0 0 2px var(--accent), 0 0 28px ${withAlpha(glowColor, 0.5)}`
                    : '0 4px 16px rgba(0,0,0,0.5)',
                  outline: 'none',
                }} />
                {isActive && privacyMode && activeGlowColors && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none',
                    background: `linear-gradient(135deg, ${activeGlowColors[0]}, ${activeGlowColors[1]})`,
                  }} />
                )}
              </div>
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
