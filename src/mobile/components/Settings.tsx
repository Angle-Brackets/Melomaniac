import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FiTrash2 } from 'react-icons/fi';
import { Icons } from '../icons';
import { MMTabBar, usePullToRefresh, PullSpinner } from './common';
import type { TabId } from './common';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../../shared/themes';
import type { ThemeName } from '../../shared/themes';
import { useStore } from '../../store';
import type { TrackStats, TrackRecord } from '../../store/types';

const SETTINGS_KEY = 'melomaniac.settings';

function fmtBytes(b: number): string {
  if (b < 1024)            return `${b} B`;
  if (b < 1024 ** 2)      return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)      return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
const GITHUB_URL   = 'https://github.com/Angle-Brackets/Melomaniac';
const BUILD_DATE   = __BUILD_DATE__;

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
  privacyMode: boolean;
  [key: string]: unknown;
}

const DEFAULTS: StoredSettings = {
  theme: 'warm',
  accentHue: 28,
  customAccentHue: 200,
  commitAuthor: '',
  privacyMode: false,
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
    const next = { ...existing, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('mm-settings-change', { detail: next }));
  } catch { /* ignore */ }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SettingsGroup({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ margin: '14px 16px 0' }}>
      <div style={{ padding: '0 8px 6px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
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
  const openPairingDisplay      = useStore(s => s.openPairingDisplay);
  const livePeers               = useStore(s => s.livePeers);
  const knownDevices            = useStore(s => s.knownDevices);
  const refreshLivePeers        = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices     = useStore(s => s.refreshKnownDevices);
  const openPeerManifest        = useStore(s => s.openPeerManifest);

  const liveKeys = new Set(livePeers.map(p => p.public_key_b64));
  const offlineDevices = knownDevices.filter(d => !liveKeys.has(d.public_key_b64));

  const [editingKey,  setEditingKey]  = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingKey) editInputRef.current?.focus(); }, [editingKey]);

  const commitRename = (pk: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      invoke('sync_rename_device', { publicKeyB64: pk, newName: trimmed })
        .then(refreshKnownDevices)
        .catch(console.error);
    }
    setEditingKey(null);
  };
  const pendingConflictPlaylists = useStore(s => s.pendingConflictPlaylists);
  const playlists               = useStore(s => s.playlists);
  const reopenConflict          = useStore(s => s.reopenConflict);
  const handleRefresh       = useCallback(async () => {
    await Promise.all([refreshLivePeers(), refreshKnownDevices()]);
  }, [refreshLivePeers, refreshKnownDevices]);
  const { scrollRef, pullY, refreshing } = usePullToRefresh(handleRefresh);
  const [settings, setSettings] = useState<StoredSettings>(() => loadSettings());
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [authorDraft, setAuthorDraft]     = useState(settings.commitAuthor);
  const authorInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats]         = useState<{ memory_mb: number; cpu_usage: number } | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [topTracks, setTopTracks] = useState<Array<{ hash: string; stats: TrackStats; track: TrackRecord | null }>>([]);
  const [confirmClear, setConfirmClear] = useState(false);

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

  const loadTopTracks = useCallback(() => {
    Promise.all([
      invoke<[string, TrackStats][]>('library_get_top_tracks', { limit: 10 }),
      invoke<TrackRecord[]>('library_get_all'),
    ]).then(([pairs, allTracks]) => {
      const trackMap = new Map<string, TrackRecord>(allTracks.map(t => [t.hash, t]));
      setTopTracks(pairs.map(([hash, trackStats]) => ({
        hash,
        stats: trackStats,
        track: trackMap.get(hash) ?? null,
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => { loadTopTracks(); }, []);

  // Focus author input when entering edit mode
  useEffect(() => {
    if (editingAuthor) authorInputRef.current?.focus();
  }, [editingAuthor]);

  // 5 s poll while Settings is visible — faster than MobileApp's 15 s background poll
  // so the peer list feels responsive when the user is actively on this screen.
  useEffect(() => {
    refreshLivePeers();
    const id = setInterval(refreshLivePeers, 5000);
    return () => clearInterval(id);
  }, [refreshLivePeers]);

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
      <div ref={scrollRef} style={{ position: 'absolute', inset: 'calc(16px + var(--safe-top)) 0 var(--tab-h)', overflowY: 'auto' }} className="mm-scroll">
        <PullSpinner pullY={pullY} refreshing={refreshing}/>

        {/* Header */}
        <div style={{ padding: '12px 22px 6px' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>Settings</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>v{__APP_VERSION__} · mobile</div>
        </div>

        {/* Conflict resolution banner — shown when any playlist has an unresolved merge */}
        {pendingConflictPlaylists.length > 0 && (
          <div style={{ margin: '6px 16px 0', padding: '12px 14px', borderRadius: 14, background: 'oklch(0.35 0.1 50 / 0.35)', border: '0.5px solid oklch(0.65 0.15 50 / 0.6)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.85 0.12 50)' }}>
                {pendingConflictPlaylists.length === 1
                  ? 'Merge conflict needs resolution'
                  : `${pendingConflictPlaylists.length} playlists have merge conflicts`}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 }}>
                {pendingConflictPlaylists
                  .map(id => playlists.find(p => p.id === id)?.name ?? id.slice(0, 8))
                  .join(', ')}
              </div>
            </div>
            <button
              onClick={() => reopenConflict(pendingConflictPlaylists[0])}
              style={{ padding: '6px 12px', borderRadius: 99, background: 'oklch(0.65 0.15 50)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
            >
              Resolve
            </button>
          </div>
        )}

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
              {/* Rainbow track with circle thumb */}
              <div style={{ flex: 1, position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3,
                  background: 'linear-gradient(90deg, oklch(0.62 0.15 0), oklch(0.62 0.15 60), oklch(0.62 0.15 120), oklch(0.62 0.15 180), oklch(0.62 0.15 240), oklch(0.62 0.15 300), oklch(0.62 0.15 360))',
                  pointerEvents: 'none',
                }}/>
                {/* Circle thumb positioned along the track */}
                <div style={{
                  position: 'absolute',
                  left: `calc(${(settings.accentHue / 360) * 100}% - 11px)`,
                  width: 22, height: 22, borderRadius: 11,
                  background: `oklch(0.62 0.15 ${settings.accentHue})`,
                  border: '2px solid rgba(255,255,255,0.55)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                }}/>
                <input
                  type="range" min={0} max={360} value={settings.accentHue}
                  onChange={e => handleHueChange(Number(e.target.value))}
                  style={{ position: 'relative', width: '100%', margin: 0, opacity: 0, cursor: 'pointer', height: 22, zIndex: 1 }}
                />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', width: 28, textAlign: 'right' }}>{settings.accentHue}°</span>
            </div>
          </div>
        </SettingsGroup>

        {/* Privacy */}
        <SettingsGroup label="Privacy">
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: 'var(--text-0)' }}>Privacy Mode</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Blur album art so others can't see what's playing</div>
            </div>
            <input
              type="checkbox"
              checked={!!settings.privacyMode}
              onChange={e => {
                const enabled = e.target.checked;
                const patch = { privacyMode: enabled };
                setSettings(prev => ({ ...prev, ...patch }));
                saveSettings(patch);
                invoke('audio_set_privacy_mode', { enabled }).catch(console.error);
              }}
              style={{ width: 44, height: 24, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
            />
          </div>
        </SettingsGroup>

        {/* Library */}
        <SettingsGroup label="Library">
          <Row title="Offline storage" detail={storageBytes !== null ? fmtBytes(storageBytes) : '…'} chev={false}/>
          <Row title="Streaming quality" detail="N/A" chev={false} muted/>
          <Row title="Crossfade" detail="N/A" chev={false} isLast muted/>
        </SettingsGroup>

        {/* History */}
        {topTracks.length > 0 && (
          <SettingsGroup
            label="History"
            action={
              confirmClear ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-1)' }}>Are you sure?</span>
                  <button
                    onClick={async () => {
                      await invoke('library_clear_history');
                      setConfirmClear(false);
                      loadTopTracks();
                    }}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #c0392b', background: '#c0392b22', color: '#e05050', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-2)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, display: 'flex', alignItems: 'center' }}
                  title="Clear listening history"
                >
                  <FiTrash2 size={13} />
                </button>
              )
            }
          >
            {topTracks.map(({ hash, stats: trackStats, track }, idx) => (
              <div
                key={hash}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px',
                  borderBottom: idx < topTracks.length - 1 ? '0.5px solid var(--border-0)' : 'none',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', width: 18, textAlign: 'right', flexShrink: 0 }}>
                  {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {track?.title ?? hash.slice(0, 10) + '…'}
                  </div>
                  {track?.artist && (
                    <div style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {track.artist}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {trackStats.play_count}×
                  </div>
                  {trackStats.skip_count > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {trackStats.skip_count} skip{trackStats.skip_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </SettingsGroup>
        )}

        {/* Developer */}
        <SettingsGroup label="Developer">
          <Row title="RAM usage" detail={stats ? `${stats.memory_mb.toFixed(1)} MB` : '…'} chev={false}/>
          <Row title="CPU usage" detail={stats ? `${stats.cpu_usage.toFixed(1)}%` : '…'} chev={false} isLast/>
        </SettingsGroup>

        {/* Sync */}
        <SettingsGroup label="Sync">
          {livePeers.map((peer) => (
            <div key={peer.public_key_b64} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '0.5px solid var(--border-0)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: 'oklch(0.72 0.17 142)', flexShrink: 0 }}/>
              {editingKey === peer.public_key_b64 ? (
                <input
                  ref={editInputRef}
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => setEditingKey(null)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(peer.public_key_b64, editingName);
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  style={{ flex: 1, fontSize: 14, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '2px 6px', color: 'var(--text-0)', outline: 'none' }}
                />
              ) : (
                <span
                  onClick={() => { setEditingKey(peer.public_key_b64); setEditingName(peer.display_name); }}
                  style={{ flex: 1, fontSize: 14, color: 'var(--text-0)', cursor: 'pointer' }}
                >{peer.display_name}</span>
              )}
              {peer.latency_ms != null && <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{peer.latency_ms}ms</span>}
              <span onClick={() => openPeerManifest(peer)} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>Sync</span>
            </div>
          ))}
          {offlineDevices.map((device) => (
            <div key={device.public_key_b64} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '0.5px solid var(--border-0)', opacity: 0.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--border-2)', flexShrink: 0 }}/>
              {editingKey === device.public_key_b64 ? (
                <input
                  ref={editingKey === device.public_key_b64 ? editInputRef : undefined}
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => setEditingKey(null)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(device.public_key_b64, editingName);
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  style={{ flex: 1, fontSize: 14, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '2px 6px', color: 'var(--text-0)', outline: 'none' }}
                />
              ) : (
                <span
                  onClick={() => { setEditingKey(device.public_key_b64); setEditingName(device.display_name); }}
                  style={{ flex: 1, fontSize: 14, color: 'var(--text-0)', cursor: 'pointer' }}
                >{device.display_name}</span>
              )}
              <button
                onClick={() => invoke('sync_remove_device', { publicKeyB64: device.public_key_b64 }).then(refreshKnownDevices).catch(console.error)}
                style={{ fontSize: 12, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
              >Remove</button>
            </div>
          ))}
          <Row title="Pair a device" chev isLast onClick={() => { openPairingDisplay().catch(console.error); }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>QR</span>
          </Row>
        </SettingsGroup>

        {/* About */}
        <SettingsGroup label="About">
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border-0)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}>Melomaniac v{__APP_VERSION__}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>Tauri 2 · React · Rust · GPLv3</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>By Soupa · built {BUILD_DATE}</div>
          </div>
          <Row
            title="Source on GitHub"
            chev
            onClick={() => invoke('open_url_in_app', { url: GITHUB_URL }).catch(console.error)}
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
