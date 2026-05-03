import type { Tweaks } from '../types';

interface SettingsModalProps {
  tweaks: Tweaks;
  setTweak: (key: keyof Tweaks | Partial<Tweaks>, value?: unknown) => void;
  onClose: () => void;
  onReset: () => void;
}

const THEMES = ['warm', 'cool', 'forest', 'violet'] as const;
const DENSITIES = ['compact', 'normal', 'relaxed'] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-0)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>{children}</div>
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border-1)'}`,
      background: active ? 'var(--bg-5)' : 'transparent',
      color: active ? 'var(--accent-light)' : 'var(--text-2)',
      fontFamily: "'Outfit', sans-serif", transition: 'all 0.13s',
    }}>{label}</button>
  );
}

export default function SettingsModal({ tweaks, setTweak, onClose, onReset }: SettingsModalProps) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: 'rgba(8,5,2,0.78)', backdropFilter: 'blur(5px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, background: 'var(--bg-1)', borderRadius: 10,
        border: '1px solid var(--border-2)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-1)', background: 'var(--bg-0)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Melomaniac Settings</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--border-1)', borderRadius: 5,
            color: 'var(--text-2)', fontSize: 11, padding: '2px 9px', cursor: 'pointer',
            fontFamily: "'Outfit', sans-serif",
          }}>✕</button>
        </div>

        <div style={{ padding: '14px 18px' }}>
          <SectionLabel>Appearance</SectionLabel>

          <Row label="Color theme">
            {THEMES.map(t => (
              <Pill key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} active={tweaks.theme === t} onClick={() => {
                const hue = t === 'warm' ? 28 : t === 'cool' ? 210 : t === 'forest' ? 135 : 280;
                setTweak({ theme: t, accentHue: hue });
              }} />
            ))}
          </Row>

          <Row label="Accent hue">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0} max={360} value={tweaks.accentHue}
                onChange={e => setTweak('accentHue', Number(e.target.value))}
                style={{ width: 140, accentColor: 'var(--accent)' }} />
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: `oklch(0.65 0.15 ${tweaks.accentHue})`, border: '1px solid var(--border-1)' }} />
            </div>
          </Row>

          <Row label="Track list density">
            {DENSITIES.map(d => (
              <Pill key={d} label={d.charAt(0).toUpperCase() + d.slice(1)} active={tweaks.density === d} onClick={() => setTweak('density', d)} />
            ))}
          </Row>

          <Row label="Show right panel">
            <button onClick={() => setTweak('showRightPanel', !tweaks.showRightPanel)} style={{
              width: 38, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none',
              background: tweaks.showRightPanel ? 'var(--accent)' : 'var(--bg-5)',
              position: 'relative', transition: 'background 0.2s',
            }}>
              <div style={{
                position: 'absolute', top: 2, left: tweaks.showRightPanel ? 20 : 2,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </button>
          </Row>

          <SectionLabel style={{ marginTop: 14 }}>Library</SectionLabel>

          <Row label="Default playlist view">
            {(['Tracks', 'History'] as const).map(v => (
              <Pill key={v} label={v} active={tweaks.defaultView === v} onClick={() => setTweak('defaultView', v)} />
            ))}
          </Row>

          <Row label="Carousel card size">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={120} max={240} step={10} value={tweaks.carouselSize}
                onChange={e => setTweak('carouselSize', Number(e.target.value))}
                style={{ width: 140, accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", minWidth: 28 }}>{tweaks.carouselSize}px</span>
            </div>
          </Row>

          <SectionLabel style={{ marginTop: 14 }}>About</SectionLabel>
          <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-1)' }}>Melomaniac v0.0.1-alpha</div>
              <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>Tauri 2 · React · Rust · GPLv3</div>
            </div>
            <button onClick={onReset} style={{
              padding: '4px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
              border: '1px solid var(--border-2)', background: 'var(--bg-4)',
              color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
            }}>Reset to defaults</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6, ...style }}>
      {children}
    </div>
  );
}
