import React, { useRef, useState } from 'react';
import { Icons } from '../icons';
import type { Album } from '../data';

export type TabId = 'library' | 'playlists' | 'now' | 'discover' | 'settings';

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

// ── Bottom tab bar
export function MMTabBar({ active, onTab, style }: { active: TabId; onTab: (id: TabId) => void; style?: React.CSSProperties }) {
  const tabs: { id: TabId; label: string; Icon: (p: { size?: number }) => React.ReactElement; center?: boolean }[] = [
    { id: 'library',   label: 'Library',   Icon: Icons.library },
    { id: 'playlists', label: 'Playlists', Icon: Icons.stack },
    { id: 'now',       label: 'Player',    Icon: Icons.playCircle, center: true },
    { id: 'discover',  label: 'Discover',  Icon: Icons.sparkles },
    { id: 'settings',  label: 'Settings',  Icon: Icons.gear },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
      height: 86, paddingBottom: 26,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
      background: 'var(--bg-0)',
      borderTop: '0.5px solid var(--border-0)',
      ...style,
    }}>
      {tabs.map(t => {
        const on = active === t.id;
        const color = on ? 'var(--accent)' : 'var(--text-2)';
        return (
          <button key={t.id} onClick={() => onTab(t.id)} style={{
            flex: 1, height: 60, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'transparent', border: 'none', cursor: 'pointer', color,
            paddingTop: t.center ? 0 : 8,
          }}>
            <div style={{
              width: t.center ? 44 : 26, height: t.center ? 44 : 26,
              borderRadius: t.center ? 22 : 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: t.center && on ? 'var(--accent)' : 'transparent',
              boxShadow: t.center && on ? '0 6px 22px oklch(0.62 0.15 28 / 0.5)' : 'none',
              color: t.center && on ? 'var(--bg-0)' : color,
              transition: 'all 0.2s',
            }}>
              <t.Icon size={t.center ? 26 : 22}/>
            </div>
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.02 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Bottom sheet
export function MMSheet({ title, subtitle, children, height = '72%', accessory, animStyle, onClose }: {
  title: string; subtitle?: string; children: React.ReactNode;
  height?: string; accessory?: React.ReactNode; animStyle?: React.CSSProperties;
  onClose?: () => void;
}) {
  const startYRef  = useRef<number | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const dismiss = () => {
    if (!onClose || dismissing) return;
    setDismissing(true);
    setTimeout(onClose, 270);
  };

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height,
      background: 'var(--bg-2)',
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      border: '0.5px solid var(--border-1)', borderBottom: 'none',
      boxShadow: '0 -20px 50px rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 50,
      ...animStyle,
      animation: dismissing ? 'mmSheetDown 0.27s ease-in both' : animStyle?.animation,
    }}>
      {/* drag handle — touch here to swipe-dismiss */}
      <div
        onTouchStart={e => { startYRef.current = e.touches[0].clientY; }}
        onTouchEnd={e => {
          if (startYRef.current === null) return;
          const dy = e.changedTouches[0].clientY - startYRef.current;
          startYRef.current = null;
          if (dy > 52) dismiss();
        }}
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

// ── Icon button helper
export function iconBtn(s = 32): React.CSSProperties {
  return {
    width: s, height: s, borderRadius: s / 2,
    background: 'transparent', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
}
