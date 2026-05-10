import React from 'react';
import { Icons } from '../icons';
import { MMTabBar } from './common';
import type { TabId } from './common';

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '14px 16px 0' }}>
      <div style={{ padding: '0 8px 6px', fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</div>
      <div style={{ background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', borderRadius: 14, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ title, detail, toggle, on, chev = true, isLast }: {
  title: string; detail?: string; toggle?: boolean; on?: boolean; chev?: boolean; isLast?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: isLast ? 'none' : '0.5px solid var(--border-0)' }}>
      <span style={{ flex: 1, fontSize: 14, color: 'var(--text-0)' }}>{title}</span>
      {detail && <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: detail.match(/^[0-9]/) ? 'JetBrains Mono, monospace' : 'inherit' }}>{detail}</span>}
      {toggle ? (
        <div style={{ width: 38, height: 22, borderRadius: 11, background: on ? 'var(--accent)' : 'var(--bg-4)', position: 'relative', transition: 'all 0.2s', cursor: 'pointer' }}>
          <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'all 0.2s' }}/>
        </div>
      ) : chev ? <Icons.chevRight size={14} stroke="var(--text-3)"/> : null}
    </div>
  );
}

export function Settings({ onTab }: { onTab: (id: TabId) => void }) {
  const themes = [
    { name: 'warm', label: 'Warm', hue: 28 },
    { name: 'cool', label: 'Cool', hue: 220 },
    { name: 'forest', label: 'Forest', hue: 140 },
    { name: 'violet', label: 'Violet', hue: 280 },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '12px 22px 6px' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>Settings</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>v0.1 alpha · mobile</div>
        </div>

        <div style={{ margin: '12px 16px 4px', padding: '12px', borderRadius: 14, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg-0)', fontWeight: 700, fontSize: 18 }}>K</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600 }}>Kale</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>commits as "kale@mobile"</div>
          </div>
          <Icons.edit size={16} stroke="var(--text-2)"/>
        </div>

        <SettingsGroup label="Theme">
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {themes.map(t => (
                <button key={t.name} style={{ padding: 10, borderRadius: 12, background: t.name === 'warm' ? 'var(--bg-4)' : 'var(--bg-3)', border: `0.5px solid ${t.name === 'warm' ? 'var(--accent)' : 'var(--border-1)'}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, oklch(0.72 0.14 ${t.hue}), oklch(0.38 0.10 ${t.hue}))` }}/>
                  <span style={{ fontSize: 11, color: 'var(--text-1)' }}>{t.label}</span>
                </button>
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: 0.12, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>Custom hue</span>
                <span style={{ fontSize: 11, color: 'var(--text-0)', fontFamily: 'JetBrains Mono, monospace' }}>28°</span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'linear-gradient(90deg, oklch(0.62 0.15 0), oklch(0.62 0.15 60), oklch(0.62 0.15 120), oklch(0.62 0.15 180), oklch(0.62 0.15 240), oklch(0.62 0.15 300), oklch(0.62 0.15 360))', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '8%', top: -3, width: 16, height: 16, borderRadius: 8, background: 'var(--accent)', border: '2px solid var(--bg-0)', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}/>
              </div>
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup label="Library">
          <Row title="Offline storage" detail="12.4 GB"/>
          <Row title="Streaming quality" detail="High"/>
          <Row title="Crossfade" detail="3s" isLast/>
        </SettingsGroup>

        <SettingsGroup label="Sync">
          <Row title="Cloud sync" toggle on/>
          <Row title="Sync on Wi-Fi only" toggle on/>
          <Row title="Last synced" detail="2m ago" chev={false} isLast/>
        </SettingsGroup>

        <SettingsGroup label="Developer">
          <Row title="Developer mode" toggle on/>
          <Row title="Show commit graph" toggle on/>
          <Row title="Default merge strategy" detail="Union"/>
          <Row title="Diagnostic logs" detail="enabled" isLast/>
        </SettingsGroup>

        <SettingsGroup label="About">
          <Row title="Acknowledgements"/>
          <Row title="Source on GitHub" detail="git@v0.1.0" isLast/>
        </SettingsGroup>

        <div style={{ height: 22 }}/>
      </div>

      <MMTabBar active="settings" onTab={onTab}/>
    </div>
  );
}
