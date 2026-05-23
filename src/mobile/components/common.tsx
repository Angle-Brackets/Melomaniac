import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Icons } from '../icons';
import type { Album } from '../data';

export type TabId = 'library' | 'playlists' | 'now' | 'discover' | 'settings';

// ── Hook: keeps a loading flag visible for at least `minMs` milliseconds
// so fast loads still show enough animation to be perceptible.
export function useMinDuration(loading: boolean, minMs = 600): boolean {
  const [visible, setVisible] = useState(loading);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      startRef.current = Date.now();
      setVisible(true);
    } else if (startRef.current !== null) {
      const elapsed = Date.now() - startRef.current;
      const remaining = minMs - elapsed;
      if (remaining <= 0) {
        setVisible(false);
      } else {
        const t = setTimeout(() => setVisible(false), remaining);
        return () => clearTimeout(t);
      }
    }
  }, [loading, minMs]);

  return visible;
}

// ── Album cover
export function MMArt({ album, src, size = 64, radius = 10, glow = false, style = {} }: {
  album?: Album; src?: string; size?: number; radius?: number; glow?: boolean; style?: React.CSSProperties;
}) {
  const accent = album?.accent ?? 'var(--accent)';
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: src ? 'transparent' : (album?.gradient ?? 'var(--bg-3)'),
      position: 'relative', overflow: 'hidden',
      flexShrink: 0,
      boxShadow: glow
        ? `0 6px 22px rgba(0,0,0,0.55), 0 0 32px ${accent}44`
        : '0 2px 8px rgba(0,0,0,0.45)',
      ...style,
    }}>
      {/* Use <img> instead of background-image so WebKit compositing layers
          render at device pixel ratio, not CSS pixel ratio. */}
      {src && (
        <img
          src={src}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            display: 'block',
          }}
        />
      )}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.55, mixBlendMode: 'overlay',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.75\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.08\'/%3E%3C/svg%3E")',
        pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '28%',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.45))', pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '40%',
        background: `radial-gradient(ellipse at 60% 0%, ${accent}55 0%, transparent 75%)`, pointerEvents: 'none',
      }}/>
    </div>
  );
}

// ── Status bar
export function MMStatusBar({ time = '9:41' }: { time?: string }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
      height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 32px 0', color: 'var(--text-0)', pointerEvents: 'none',
    }}>
      <span style={{ fontFamily: '-apple-system, "SF Pro", system-ui', fontSize: 17, fontWeight: 600, letterSpacing: 0.2 }}>{time}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="18" height="11" viewBox="0 0 18 11">
          <rect x="0" y="7" width="3" height="4" rx="0.6" fill="currentColor"/>
          <rect x="4.6" y="4.5" width="3" height="6.5" rx="0.6" fill="currentColor"/>
          <rect x="9.2" y="2" width="3" height="9" rx="0.6" fill="currentColor"/>
          <rect x="13.8" y="0" width="3" height="11" rx="0.6" fill="currentColor"/>
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
          <path d="M8 3a8 8 0 015.7 2.4l1-1A9.5 9.5 0 008 1.5 9.5 9.5 0 001.3 4.4l1 1A8 8 0 018 3z"/>
          <path d="M8 6.4a4.5 4.5 0 013.2 1.3l1-1A6 6 0 008 5a6 6 0 00-4.2 1.7l1 1A4.5 4.5 0 018 6.4z"/>
          <circle cx="8" cy="10" r="1.3"/>
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="currentColor" strokeOpacity="0.45" fill="none"/>
          <rect x="2" y="2" width="18" height="8" rx="1.5" fill="currentColor"/>
          <path d="M23 4v4c.7-.3 1.3-1 1.3-2s-.6-1.7-1.3-2z" fill="currentColor" opacity="0.55"/>
        </svg>
      </div>
    </div>
  );
}

// ── Dynamic Island showing active branch
export function MMIsland({ branch, syncing = false }: { branch: string; syncing?: boolean }) {
  return (
    <div style={{
      position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
      minWidth: 126, height: 37, borderRadius: 22, background: '#000', zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px 0 12px', gap: 12, color: 'var(--text-0)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)' }}>⎇</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-0)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 6, height: 6, borderRadius: 99,
          background: syncing ? 'var(--accent)' : 'var(--green)',
          boxShadow: `0 0 6px ${syncing ? 'var(--accent)' : 'var(--green)'}`,
        }}/>
      </div>
    </div>
  );
}

// ── Bottom tab bar ─────────────────────────────────────────────────────────────
// Five tabs: Library, Playlists, Player (center FAB), Discover, Settings.
// The center "now" tab renders as a large circular accent button (FAB-style)
// rather than a text+icon combo to give it visual priority as the primary screen.
// Discover is temporarily disabled (opacity + pointerEvents: none) until the
// feature is implemented — the "soon" label communicates this to users.
export function MMTabBar({ active, onTab, style }: { active: TabId; onTab: (id: TabId) => void; style?: React.CSSProperties }) {
  const tabs: { id: TabId; label: string; Icon: (p: { size?: number }) => React.ReactElement; center?: boolean }[] = [
    { id: 'library',   label: 'Library',   Icon: Icons.library },
    { id: 'playlists', label: 'Playlists', Icon: Icons.stack },
    { id: 'now',       label: 'Player',    Icon: Icons.playCircle, center: true },
    { id: 'discover',  label: 'Discover',  Icon: Icons.sparkles },
    { id: 'settings',  label: 'Settings',  Icon: Icons.gear },
  ];
  // Track which tab was previously active so we only animate newly-selected icons
  const prevActiveRef = useRef(active);
  const justSelected = useRef<TabId | null>(null);
  const handleTab = (id: TabId) => {
    justSelected.current = id;
    prevActiveRef.current = active;
    onTab(id);
  };

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
      height: 'var(--tab-h)', paddingBottom: 'var(--safe-bottom)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
      background: 'var(--bg-0)',
      borderTop: '0.5px solid var(--border-0)',
      ...style,
    }}>
      {tabs.map(t => {
        const disabled = t.id === 'discover';
        const on = active === t.id;
        const color = on ? 'var(--accent)' : 'var(--text-2)';
        const popped = justSelected.current === t.id && on;
        if (popped) justSelected.current = null; // consume after first render
        return (
          <button key={t.id} onClick={() => !disabled && handleTab(t.id)} style={{
            flex: 1, height: 60, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'transparent', border: 'none',
            cursor: disabled ? 'default' : 'pointer',
            color,
            paddingTop: t.center ? 0 : 8,
            opacity: disabled ? 0.35 : 1,
            pointerEvents: disabled ? 'none' : 'auto',
          }}>
            <div style={{
              width: t.center ? 44 : 26, height: t.center ? 44 : 26,
              borderRadius: t.center ? 22 : 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: t.center && on ? 'var(--accent)' : 'transparent',
              boxShadow: t.center && on ? '0 6px 22px oklch(0.62 0.15 28 / 0.5)' : 'none',
              color: t.center && on ? 'var(--bg-0)' : color,
              transition: 'background 0.2s, box-shadow 0.2s, color 0.2s',
              animation: popped ? 'mmTabPop 0.32s cubic-bezier(0.22,1,0.36,1) both' : 'none',
            }}>
              <t.Icon size={t.center ? 26 : 22}/>
            </div>
            <span style={{ fontSize: 10, fontWeight: on ? 600 : 500, letterSpacing: 0.02, transition: 'font-weight 0.15s' }}>{t.label}</span>
            {disabled && <span style={{ fontSize: 8, color: 'var(--text-2)', letterSpacing: 0.05, marginTop: -1 }}>soon</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Bottom sheet
export function MMSheet({ title, subtitle, children, height = '72%', accessory, animStyle, onClose, expandable = false }: {
  title: string; subtitle?: string; children: React.ReactNode;
  height?: string; accessory?: React.ReactNode; animStyle?: React.CSSProperties;
  onClose?: () => void; expandable?: boolean;
}) {
  const startYRef   = useRef<number | null>(null);
  const lastYRef    = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [expanded,   setExpanded]   = useState(false);

  const dismiss = () => {
    if (!onClose || dismissing) return;
    setDismissing(true);
    setTimeout(onClose, 270);
  };

  const currentHeight = expandable && expanded ? '92%' : height;
  const isDragging    = dragOffset !== 0;

  const onDragStart = (e: React.PointerEvent) => {
    startYRef.current = e.clientY;
    lastYRef.current  = e.clientY;
    lastTimeRef.current = Date.now();
    velocityRef.current = 0;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (startYRef.current === null) return;
    const now = Date.now();
    const dt  = now - lastTimeRef.current;
    if (dt > 0) velocityRef.current = (e.clientY - lastYRef.current) / dt * 1000;
    lastYRef.current  = e.clientY;
    lastTimeRef.current = now;
    const totalDy = e.clientY - startYRef.current;
    // Only drag downward visually; upward drag is a snap-only gesture
    setDragOffset(Math.max(0, totalDy));
  };

  const onDragEnd = (e: React.PointerEvent) => {
    if (startYRef.current === null) return;
    const totalDy = e.clientY - startYRef.current;
    const v = velocityRef.current;
    startYRef.current = null;

    if (expandable && !expanded && (totalDy < -60 || v < -400)) {
      setDragOffset(0); setExpanded(true); return;
    }
    if (expandable && expanded && (totalDy > 44 || v > 280)) {
      setDragOffset(0); setExpanded(false); return;
    }
    if (!expanded && (totalDy > 44 || v > 280)) {
      setDragOffset(0); dismiss(); return;
    }
    setDragOffset(0); // spring back
  };

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: currentHeight,
      transform: `translateY(${dragOffset}px)`,
      transition: dismissing
        ? 'none'
        : isDragging
          ? 'height 0.35s cubic-bezier(0.22,1,0.36,1)'
          : 'transform 0.3s cubic-bezier(0.22,1,0.36,1), height 0.35s cubic-bezier(0.22,1,0.36,1)',
      background: 'var(--bg-2)',
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      border: '0.5px solid var(--border-1)', borderBottom: 'none',
      boxShadow: '0 -20px 50px rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 50,
      ...animStyle,
      animation: dismissing ? 'mmSheetDown 0.27s ease-in both' : animStyle?.animation,
    }}>
      {/* drag handle — swipe up to expand, swipe down to collapse/dismiss */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px', touchAction: 'none' }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border-2)' }}/>
      </div>
      <div style={{ padding: '6px 20px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-0)', letterSpacing: -0.2 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>{subtitle}</div>}
        </div>
        {accessory}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 28px' }} className="mm-scroll">
        {children}
      </div>
    </div>
  );
}

// ── Monospace chip
export function MMHash({ children, color = 'var(--text-2)' }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color, letterSpacing: 0.02 }}>
      {children}
    </span>
  );
}

// ── Branch pill
export function MMBranchPill({ branch, color = 'var(--accent)', size = 'sm' }: {
  branch: string; color?: string; size?: 'sm' | 'md';
}) {
  const isSm = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: isSm ? '3px 9px' : '5px 12px',
      borderRadius: 99, border: `1px solid ${color}55`,
      background: `${color}18`, color,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: isSm ? 10.5 : 12, letterSpacing: 0.02, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: isSm ? 11 : 13 }}>⎇</span>{branch}
    </span>
  );
}

// ── Icon button helper — returns inline styles, not a component
export function iconBtn(s = 32): React.CSSProperties {
  return {
    width: s, height: s, borderRadius: s / 2,
    background: 'transparent', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
}

// ── Loading indicator — dancing eighth note (keyframe defined in main.css)
export function MMLoader({ size = 36, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 0' }}>
      <span style={{
        fontSize: size, color,
        display: 'inline-block',
        animation: 'mmNoteDance 1.1s ease-in-out infinite',
        transformOrigin: 'bottom center',
        filter: `drop-shadow(0 0 8px ${color}88)`,
      }}>♪</span>
    </div>
  );
}

// ── MarqueeText ────────────────────────────────────────────────────────────────
// Scrolls the text horizontally (ticker-tape style) when it overflows its
// container AND active=true (i.e. the track is currently playing).
// Flow: render a static <span> → measure with useLayoutEffect → if overflow > 4px,
// swap to an animating <span> that contains two copies of the text separated by
// MARQUEE_GAP, with a CSS translate animation that moves by exactly (textWidth +
// gap) so the second copy lands in the same position as the first — seamless loop.
// useLayoutEffect is used instead of useEffect to avoid a one-frame jump where
// the centered static text is briefly visible before the scrolling span mounts.
// When `text` changes mid-scroll (track changes), `measuredFor` forces a reset
// back to the static span so measurement can happen again before restarting.
const MARQUEE_GAP = 48;
export function MarqueeText({ text, active, style, textStyle }: {
  text: string; active: boolean;
  style?: React.CSSProperties; textStyle?: React.CSSProperties;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [marq, setMarq] = useState<{ w: number; on: boolean }>({ w: 0, on: false });
  // Track which text value the current marq state was measured for.
  // When text changes while scrolling, innerRef is null (measurement span unmounted),
  // so we reset at render time to get the static span back before the next measurement.
  const [measuredFor, setMeasuredFor] = useState(text);
  if (measuredFor !== text) {
    setMeasuredFor(text);
    if (marq.on) setMarq({ w: 0, on: false });
  }

  // useLayoutEffect fires before paint — eliminates the one-frame flash where
  // centered static text jumps to the left edge when scrolling starts.
  useLayoutEffect(() => {
    if (!active) { setMarq(m => m.on ? { w: 0, on: false } : m); return; }
    const o = outerRef.current, i = innerRef.current;
    if (!o || !i) return; // null when marq.on=true (scrolling span is mounted instead)
    if (i.scrollWidth - o.clientWidth > 4) setMarq({ w: i.scrollWidth, on: true });
  }, [active, measuredFor]);

  return (
    <div ref={outerRef} style={{ overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0, ...style }}>
      {marq.on ? (
        <span style={{
          display: 'inline-flex', gap: `${MARQUEE_GAP}px`,
          animation: `mm-marquee ${Math.max(2, (marq.w + MARQUEE_GAP) / 60).toFixed(2)}s linear 0.8s infinite`,
          ['--mm-dist' as string]: `${-(marq.w + MARQUEE_GAP)}px`,
          willChange: 'transform',
          ...textStyle,
        }}>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{text}</span>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{text}</span>
        </span>
      ) : (
        <span ref={innerRef} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...textStyle }}>
          {text}
        </span>
      )}
    </div>
  );
}

// ── Pull-to-refresh ────────────────────────────────────────────────────────────

const PTR_THRESHOLD = 64;

export function usePullToRefresh(onRefresh: () => Promise<void>): { scrollRef: React.MutableRefObject<HTMLDivElement | null>; pullY: number; refreshing: boolean } {
  const scrollRef     = useRef<HTMLDivElement>(null);
  const startY        = useRef(0);
  const pullYRef      = useRef(0);
  const activeRef     = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef  = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; });

  const [state, setState] = useState<{ pullY: number; refreshing: boolean }>({ pullY: 0, refreshing: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || refreshingRef.current) return;
      startY.current = e.touches[0].clientY;
      activeRef.current = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!activeRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { activeRef.current = false; pullYRef.current = 0; setState(s => ({ ...s, pullY: 0 })); return; }
      pullYRef.current = Math.min(dy * 0.45, PTR_THRESHOLD + 24);
      setState(s => ({ ...s, pullY: pullYRef.current }));
    };

    const onEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (pullYRef.current >= PTR_THRESHOLD) {
        refreshingRef.current = true;
        pullYRef.current = PTR_THRESHOLD;
        setState({ pullY: PTR_THRESHOLD, refreshing: true });
        onRefreshRef.current().finally(() => {
          refreshingRef.current = false;
          pullYRef.current = 0;
          setState({ pullY: 0, refreshing: false });
        });
      } else {
        pullYRef.current = 0;
        setState({ pullY: 0, refreshing: false });
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { scrollRef, pullY: state.pullY, refreshing: state.refreshing };
}

export function PullSpinner({ pullY, refreshing }: { pullY: number; refreshing: boolean }) {
  if (pullY === 0 && !refreshing) return null;
  const progress = Math.min(pullY / PTR_THRESHOLD, 1);
  return (
    <div style={{
      position: 'absolute', top: pullY - 44, left: '50%',
      transform: 'translateX(-50%)',
      width: 28, height: 28,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: refreshing || pullY > 0 ? 'none' : 'top 0.3s, opacity 0.3s',
      opacity: Math.max(progress, refreshing ? 1 : 0),
      pointerEvents: 'none', zIndex: 20,
    }}>
      <div style={{
        width: 22, height: 22,
        border: '2.5px solid var(--border-2)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: refreshing ? 'mmSpin 0.7s linear infinite' : 'none',
        transform: refreshing ? 'none' : `rotate(${progress * 280}deg)`,
      }}/>
    </div>
  );
}
