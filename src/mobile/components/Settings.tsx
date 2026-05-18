import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Icons } from '../icons';
import { MMTabBar } from './common';
import type { TabId } from './common';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../../shared/themes';
import type { ThemeName } from '../../shared/themes';

const SETTINGS_KEY = 'melomaniac.settings';

function fmtBytes(b: number): string {
  if (b < 1024)            return `${b} B`;
  if (b < 1024 ** 2)      return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)      return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
const GITHUB_URL   = 'https://github.com/Angle-Brackets/Melomaniac';
const BUILD_DATE   = 'May 17, 2026';

// ── Persistence ────────────────────────────────────────────────────────────────
// All settings are written to localStorage under SETTINGS_KEY as a flat JSON
// object.  There is no remote or Tauri store — localStorage survives across
// app restarts and is synchronous, avoiding any async read-on-mount flash.
// `customAccentHue` is stored separately from `accentHue` so switching away
// from the Custom theme and back restores the slider to the user's last position.
interface StoredSettings {
  theme: ThemeName;
  accentHue: number;
  customAccentHue: number; // remembers last slider position independently of active theme
  commitAuthor: string;
  [key: string]: unknown;
}

const DEFAULTS: StoredSettings = {
  theme: 'warm',
  accentHue: 28,
  customAccentHue: 200,
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
    const existing = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { return {}; } })();
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

function Row({ title, detail, chev = false, isLast, muted, onClick, children }: {
  title: string; detail?: string; chev?: boolean; isLast?: boolean;
  muted?: boolean; onClick?: () => void; children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        borderBottom: isLast ? 'none' : '0.5px solid var(--border-0)',
        opacity: muted ? 0.45 : 1,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ flex: 1, fontSize: 14, color: 'var(--text-0)' }}>{title}</span>
      {children}
      {detail && <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: /^[0-9]/.test(detail) ? 'JetBrains Mono, monospace' : 'inherit' }}>{detail}</span>}
      {chev && <Icons.chevRight size={14} stroke="var(--text-3)"/>}
    </div>
  );
}

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
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [authorDraft, setAuthorDraft]     = useState(settings.commitAuthor);
  const authorInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats]         = useState<{ memory_mb: number; cpu_usage: number } | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  // Apply persisted theme once on mount
  useEffect(() => {
    if (settings.theme === 'custom') {
      writeCustomHue(settings.customAccentHue ?? settings.accentHue);
      applyTheme('custom');
    } else {
      applyTheme(settings.theme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Developer stats panel ──────────────────────────────────────────────────
  // Polls the Rust `get_system_stats` command every 2 s so the RAM / CPU rows
  // stay live without being so frequent they cause noticeable IPC overhead.
  useEffect(() => {
    const tick = () =>
      invoke<{ memory_mb: number; cpu_usage: number }>('get_system_stats')
        .then(setStats).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  // Storage size — read once on mount
  useEffect(() => {
    invoke<number>('library_get_storage_bytes').then(setStorageBytes).catch(() => {});
  }, []);

  // Focus author input when entering edit mode
  useEffect(() => {
    if (editingAuthor) authorInputRef.current?.focus();
  }, [editingAuthor]);

  // ── Theme helpers ─────────────────────────────────────────────────────────
  function applyAndSaveTheme(name: ThemeName) {
    let hue: number;
    if (name === 'custom') {
      // Restore the last hue the user set via the slider
      hue = settings.customAccentHue ?? settings.accentHue;
      writeCustomHue(hue);
      applyTheme('custom');
    } else {
      hue = NAMED_THEMES[name].hue;
      applyTheme(name);
    }
    const patch: Partial<StoredSettings> = { theme: name, accentHue: hue };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
  }

  function handleHueChange(hue: number) {
    // Pass the current named theme as `base` so writeCustomHue can derive the
    // saturation/lightness from that theme's palette rather than generic defaults.
    const base = settings.theme !== 'custom' ? settings.theme as Exclude<ThemeName, 'custom'> : undefined;
    writeCustomHue(hue, base);
    applyTheme('custom');
    // Save hue to both accentHue (current) and customAccentHue (Custom memory)
    const patch: Partial<StoredSettings> = { theme: 'custom', accentHue: hue, customAccentHue: hue };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
  }

  function commitAuthorName(name: string) {
    const trimmed = name.trim();
    const patch: Partial<StoredSettings> = { commitAuthor: trimmed };
    setSettings(s => ({ ...s, ...patch }));
    saveSettings(patch);
    invoke('set_commit_author', { name: trimmed }).catch(console.error);
  }

  function resetToDefaults() {
    writeCustomHue(DEFAULTS.customAccentHue);
    applyTheme('warm');
    const patch: Partial<StoredSettings> = { theme: 'warm', accentHue: 28, customAccentHue: 200, commitAuthor: '' };
    setSettings(s => ({ ...s, ...patch }));
    setAuthorDraft('');
    saveSettings(patch);
    invoke('set_commit_author', { name: '' }).catch(console.error);
  }

  const initial     = settings.commitAuthor.trim()[0]?.toUpperCase() ?? '?';
  const authorLabel = settings.commitAuthor.trim() || 'Not set';

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden', fontFamily: 'Outfit, system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', inset: 'calc(16px + var(--safe-top)) 0 var(--tab-h)', overflowY: 'auto' }} className="mm-scroll">

        {/* Header */}
        <div style={{ padding: '12px 22px 6px' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>Settings</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>v0.1 alpha · mobile</div>
        </div>

        {/* Identity card — inline editable */}
        <div style={{ margin: '12px 16px 4px', padding: '12px', borderRadius: 14, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg-0)', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingAuthor ? (
              <input
                ref={authorInputRef}
                value={authorDraft}
                onChange={e => setAuthorDraft(e.target.value)}
                onBlur={() => { commitAuthorName(authorDraft); setEditingAuthor(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { commitAuthorName(authorDraft); setEditingAuthor(false); }
                  if (e.key === 'Escape') { setAuthorDraft(settings.commitAuthor); setEditingAuthor(false); }
                }}
                placeholder="your name"
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}
              />
            ) : (
              <div style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorLabel}</div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>commit identity</div>
          </div>
          <button
            onClick={() => { setAuthorDraft(settings.commitAuthor); setEditingAuthor(e => !e); }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          >
            <Icons.edit size={16} stroke={editingAuthor ? 'var(--accent)' : 'var(--text-2)'}/>
          </button>
        </div>

        {/* Appearance */}
        <SettingsGroup label="Appearance">
          <div style={{ padding: '14px 14px 10px' }}>

            {/* Theme pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {THEME_PILLS.map(({ id, label }) => {
                const on = settings.theme === id;
                return (
                  <button
                    key={id}
                    onClick={() => applyAndSaveTheme(id)}
                    style={{
                      padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      background: on ? 'var(--accent)' : 'var(--bg-3)',
                      color: on ? 'var(--bg-0)' : 'var(--text-1)',
                      border: on ? '1.5px solid transparent' : '0.5px solid var(--border-2)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Accent hue */}
            <div style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>Accent hue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Rainbow track */}
              <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3,
                  background: 'linear-gradient(90deg, oklch(0.62 0.15 0), oklch(0.62 0.15 60), oklch(0.62 0.15 120), oklch(0.62 0.15 180), oklch(0.62 0.15 240), oklch(0.62 0.15 300), oklch(0.62 0.15 360))',
                  pointerEvents: 'none',
                }}/>
                <input
                  type="range" min={0} max={360} value={settings.accentHue}
                  onChange={e => handleHueChange(Number(e.target.value))}
                  style={{ position: 'relative', width: '100%', margin: 0, opacity: 0, cursor: 'pointer', height: 20, zIndex: 1 }}
                />
              </div>
              {/* Live preview dot — white ring ensures visibility on any hue */}
              <div style={{
                width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                background: `oklch(0.62 0.15 ${settings.accentHue})`,
                border: '2px solid rgba(255,255,255,0.55)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
              }}/>
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', width: 28, textAlign: 'right' }}>{settings.accentHue}°</span>
            </div>
          </div>
        </SettingsGroup>

        {/* Library */}
        <SettingsGroup label="Library">
          <Row title="Offline storage" detail={storageBytes !== null ? fmtBytes(storageBytes) : '…'} chev={false}/>
          <Row title="Streaming quality" detail="N/A" chev={false} muted/>
          <Row title="Crossfade" detail="N/A" chev={false} isLast muted/>
        </SettingsGroup>

        {/* Developer */}
        <SettingsGroup label="Developer">
          <Row title="RAM usage" detail={stats ? `${stats.memory_mb.toFixed(1)} MB` : '…'} chev={false}/>
          <Row title="CPU usage" detail={stats ? `${stats.cpu_usage.toFixed(1)}%` : '…'} chev={false} isLast/>
        </SettingsGroup>

        {/* About */}
        <SettingsGroup label="About">
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border-0)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}>Melomaniac v0.1 Alpha</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>Tauri 2 · React · Rust · GPLv3</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>By Soupa · built {BUILD_DATE}</div>
          </div>
          <Row
            title="Source on GitHub"
            chev
            onClick={() => open(GITHUB_URL).catch(console.error)}
          >
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>Angle-Brackets/Melomaniac</span>
          </Row>
          <Row title="Reset to defaults" isLast onClick={resetToDefaults}>
            <span style={{ fontSize: 13, color: '#f87171' }}>Reset</span>
          </Row>
        </SettingsGroup>

        <div style={{ height: 22 }}/>
      </div>

      <MMTabBar active="settings" onTab={onTab}/>
    </div>
  );
}
