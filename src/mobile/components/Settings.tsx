import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icons } from '../icons';
import { MMTabBar } from './common';
import type { TabId } from './common';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../../shared/themes';
import type { ThemeName } from '../../shared/themes';

// ── Shared localStorage key with desktop ──────────────────────────────────────
const SETTINGS_KEY = 'melomaniac.settings';

interface StoredSettings {
  theme: ThemeName;
  accentHue: number;
  commitAuthor: string;
  [key: string]: unknown; // preserve desktop-only fields on write
}

const DEFAULTS: StoredSettings = {
  theme: 'warm',
  accentHue: 28,
  commitAuthor: '',
};

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function saveSettings(patch: Partial<StoredSettings>) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch { /* ignore */ }
}

// ── Sub-components ────────────────────────────────────────────────────────────
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

function Row({ title, detail, toggle, on, onToggle, chev = true, isLast, children }: {
  title: string; detail?: string; toggle?: boolean; on?: boolean;
  onToggle?: () => void; chev?: boolean; isLast?: boolean; children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: isLast ? 'none' : '0.5px solid var(--border-0)' }}>
      <span style={{ flex: 1, fontSize: 14, color: 'var(--text-0)' }}>{title}</span>
      {children}
      {detail && <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: /^[0-9]/.test(detail) ? 'JetBrains Mono, monospace' : 'inherit' }}>{detail}</span>}
      {toggle ? (
        <div onClick={onToggle} style={{ width: 38, height: 22, borderRadius: 11, background: on ? 'var(--accent)' : 'var(--bg-4)', position: 'relative', transition: 'all 0.2s', cursor: 'pointer' }}>
          <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'all 0.2s' }}/>
        </div>
      ) : chev ? <Icons.chevRight size={14} stroke="var(--text-3)"/> : null}
    </div>
  );
}

// Named themes in display order (includes Custom pill)
const THEME_PILLS: { id: ThemeName; label: string }[] = [
  { id: 'warm',   label: 'Warm'   },
  { id: 'cool',   label: 'Cool'   },
  { id: 'forest', label: 'Forest' },
  { id: 'violet', label: 'Violet' },
  { id: 'custom', label: 'Custom' },
];

// ── Main component ────────────────────────────────────────────────────────────
export function Settings({ onTab }: { onTab: (id: TabId) => void }) {
  const [settings, setSettings] = useState<StoredSettings>(() => loadSettings());
  const [authorDraft, setAuthorDraft] = useState(settings.commitAuthor);
  const authorInputRef = useRef<HTMLInputElement>(null);

  // Apply persisted theme on mount
  useEffect(() => {
    if (settings.theme === 'custom') {
      writeCustomHue(settings.accentHue);
      applyTheme('custom');
    } else {
      applyTheme(settings.theme, settings.accentHue === NAMED_THEMES[settings.theme].hue ? undefined : settings.accentHue);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function applyAndSaveTheme(name: ThemeName) {
    applyTheme(name);
    const hue = name !== 'custom' ? NAMED_THEMES[name].hue : settings.accentHue;
    const patch: Partial<StoredSettings> = { theme: name, accentHue: hue };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
  }

  function handleHueChange(hue: number) {
    const base = settings.theme !== 'custom' ? settings.theme : undefined;
    writeCustomHue(hue, base);
    applyTheme('custom');
    const patch: Partial<StoredSettings> = { theme: 'custom', accentHue: hue };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
  }

  function commitAuthor(name: string) {
    const trimmed = name.trim();
    const patch: Partial<StoredSettings> = { commitAuthor: trimmed };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
    invoke('set_commit_author', { name: trimmed }).catch(console.error);
  }

  function resetToDefaults() {
    applyTheme('warm');
    const patch: Partial<StoredSettings> = { theme: 'warm', accentHue: 28, commitAuthor: '' };
    setSettings(s => ({ ...s, ...patch }));
    setAuthorDraft('');
    saveSettings(patch);
    invoke('set_commit_author', { name: '' }).catch(console.error);
  }

  // Avatar initial
  const initial = settings.commitAuthor.trim()[0]?.toUpperCase() ?? '?';
  const authorLabel = settings.commitAuthor.trim() || 'Not set';

  // Hue thumb position as percentage
  const huePercent = ((settings.accentHue % 360) / 360) * 100;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden', fontFamily: 'Outfit, system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        {/* Header */}
        <div style={{ padding: '12px 22px 6px' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>Settings</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>v0.1 alpha · mobile</div>
        </div>

        {/* User avatar card */}
        <div style={{ margin: '12px 16px 4px', padding: '12px', borderRadius: 14, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg-0)', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorLabel}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>commit identity</div>
          </div>
          <button
            onClick={() => authorInputRef.current?.focus()}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <Icons.edit size={16} stroke="var(--text-2)"/>
          </button>
        </div>

        {/* Appearance */}
        <SettingsGroup label="Appearance">
          <div style={{ padding: '14px 14px 10px' }}>
            {/* Theme pills */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
              {THEME_PILLS.map(t => {
                const isActive = settings.theme === t.id;
                const hue = t.id !== 'custom' ? NAMED_THEMES[t.id].hue : settings.accentHue;
                return (
                  <button
                    key={t.id}
                    onClick={() => applyAndSaveTheme(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 12px', borderRadius: 99,
                      background: isActive ? 'var(--accent)' : 'var(--bg-3)',
                      border: `0.5px solid ${isActive ? 'var(--accent)' : 'var(--border-1)'}`,
                      color: isActive ? 'var(--bg-0)' : 'var(--text-1)',
                      fontSize: 13, fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'background 0.18s, color 0.18s',
                    }}
                  >
                    <div style={{
                      width: 12, height: 12, borderRadius: 99, flexShrink: 0,
                      background: `oklch(0.62 0.15 ${hue})`,
                      boxShadow: isActive ? 'none' : `0 0 0 1px oklch(0.62 0.15 ${hue} / 0.4)`,
                    }}/>
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Accent hue slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: 0.12, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>Accent hue</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: 99, flexShrink: 0,
                    background: `oklch(0.62 0.15 ${settings.accentHue})`,
                    border: '1.5px solid var(--border-2)',
                  }}/>
                  <span style={{ fontSize: 11, color: 'var(--text-0)', fontFamily: 'JetBrains Mono, monospace', minWidth: 30, textAlign: 'right' }}>{Math.round(settings.accentHue)}°</span>
                </div>
              </div>
              {/* Rainbow track with overlaid range input */}
              <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: 10, borderRadius: 5,
                  background: 'linear-gradient(90deg, oklch(0.62 0.15 0), oklch(0.62 0.15 60), oklch(0.62 0.15 120), oklch(0.62 0.15 180), oklch(0.62 0.15 240), oklch(0.62 0.15 300), oklch(0.62 0.15 360))',
                  pointerEvents: 'none',
                }}/>
                {/* Thumb indicator positioned over the track */}
                <div style={{
                  position: 'absolute',
                  left: `calc(${huePercent}% - 8px)`,
                  width: 16, height: 16, borderRadius: 99,
                  background: `oklch(0.62 0.15 ${settings.accentHue})`,
                  border: '2px solid var(--bg-0)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  pointerEvents: 'none',
                  transition: 'left 0.05s',
                }}/>
                <input
                  type="range"
                  min={0} max={360} step={1}
                  value={settings.accentHue}
                  onChange={e => handleHueChange(Number(e.target.value))}
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    opacity: 0, cursor: 'pointer', margin: 0, padding: 0,
                  }}
                />
              </div>
            </div>
          </div>
        </SettingsGroup>

        {/* Identity */}
        <SettingsGroup label="Identity">
          <div style={{ padding: '12px 14px', borderBottom: 'none' }}>
            <div style={{ fontSize: 14, color: 'var(--text-0)', marginBottom: 8 }}>Commit author name</div>
            <input
              ref={authorInputRef}
              type="text"
              value={authorDraft}
              onChange={e => setAuthorDraft(e.target.value)}
              onBlur={() => commitAuthor(authorDraft)}
              onKeyDown={e => { if (e.key === 'Enter') { commitAuthor(authorDraft); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Your name"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-3)', border: '0.5px solid var(--border-1)',
                borderRadius: 8, padding: '8px 10px',
                fontSize: 14, color: 'var(--text-0)',
                fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
            <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
              Shown in playlist commit history
            </div>
          </div>
        </SettingsGroup>

        {/* About */}
        <SettingsGroup label="About">
          <Row title="Version" detail="Melomaniac v0.1 Alpha · mobile" chev={false}/>
          <Row title="Stack" detail="Tauri 2 · React · Rust · GPLv3" chev={false}/>
          <div style={{ padding: '12px 14px' }}>
            <button
              onClick={resetToDefaults}
              style={{
                width: '100%', padding: '10px', borderRadius: 10,
                background: 'transparent', border: '0.5px solid var(--border-2)',
                color: 'var(--text-1)', fontSize: 14, cursor: 'pointer',
                fontFamily: 'Outfit, system-ui, sans-serif',
              }}
            >
              Reset to defaults
            </button>
          </div>
        </SettingsGroup>

        <div style={{ height: 22 }}/>
      </div>

      <MMTabBar active="settings" onTab={onTab}/>
    </div>
  );
}
