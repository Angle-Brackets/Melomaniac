import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../types';
import { Density, DefaultView } from '../types';
import { NAMED_THEMES } from '../../shared/themes';
import type { ThemeName } from '../../shared/themes';
import { useStore } from '../../store';
import { invoke } from '@tauri-apps/api/core';

type NamedThemeName = Exclude<ThemeName, 'custom'>;
const NAMED_THEME_ENTRIES = Object.entries(NAMED_THEMES) as [NamedThemeName, typeof NAMED_THEMES[NamedThemeName]][];

interface SettingsModalProps {
  settings: AppSettings;
  updateSetting: (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => void;
  onClose: () => void;
  onReset: () => void;
  onPairDevice?: () => void;
  closing?: boolean;
  pendingUpdate?: { version: string } | null;
  isInstalling?: boolean;
  updateProgress?: number | null;
  updateReady?: boolean;
  onInstallUpdate?: () => void;
  onRelaunch?: () => void;
}

const DENSITIES = [Density.Compact, Density.Normal, Density.Relaxed] as const;

export default function SettingsModal({ settings, updateSetting, onClose, onReset, onPairDevice, closing, pendingUpdate, isInstalling, updateProgress, updateReady, onInstallUpdate, onRelaunch }: SettingsModalProps) {
  const livePeers           = useStore(s => s.livePeers);
  const knownDevices        = useStore(s => s.knownDevices);
  const refreshLivePeers    = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices = useStore(s => s.refreshKnownDevices);
  const openPeerManifest    = useStore(s => s.openPeerManifest);

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

  useEffect(() => {
    refreshLivePeers();
    // Poll aggressively while the settings modal is open so peer status feels live
    const id = setInterval(refreshLivePeers, 4000);
    return () => clearInterval(id);
  }, [refreshLivePeers]);
  return (
    // DaisyUI modal — backdrop click closes
    <dialog className={`modal modal-open ${closing ? 'mm-backdrop-exit' : 'mm-backdrop'}`} style={{ zIndex: 60 }}>
      <div className={`modal-box bg-mm-1 border border-mm-b2 max-w-md p-0 overflow-hidden ${closing ? 'mm-modal-box-exit' : 'mm-modal-box'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-mm-b1 bg-mm-0">
          <h3 className="font-bold text-sm text-mm-t0">Melomaniac Settings</h3>
          <button className="btn btn-ghost btn-xs btn-square" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-5">

          {/* ── Appearance ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Appearance</p>

            {/* Color theme pills */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Color theme</span>
              <div className="flex gap-1">
                {NAMED_THEME_ENTRIES.map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => updateSetting({ theme: key, accentHue: NAMED_THEMES[key].hue })}
                    className={`btn btn-xs ${settings.theme === key ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {cfg.label}
                  </button>
                ))}
                <button
                  onClick={() => updateSetting({ theme: 'custom' })}
                  className={`btn btn-xs ${settings.theme === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
                >Custom</button>
              </div>
            </div>

            {/* Accent hue slider */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Accent hue</span>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={360} value={settings.accentHue}
                  onChange={e => updateSetting('accentHue', Number(e.target.value))}
                  className="range range-primary range-xs w-36"
                />
                {/* Live hue preview dot */}
                <div
                  className="w-4 h-4 rounded-full border border-mm-b1 shrink-0"
                  style={{ background: `oklch(0.65 0.15 ${settings.accentHue})` }}
                />
              </div>
            </div>

            {/* Track list density */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Track list density</span>
              <div className="flex gap-1">
                {DENSITIES.map(d => (
                  <button
                    key={d}
                    onClick={() => updateSetting('density', d)}
                    className={`btn btn-xs ${settings.density === d ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Right panel — coming soon, not yet available */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0" title="AI & Metrics panel is not yet available">
              <div>
                <span className="text-xs text-mm-t1">Show AI & Metrics panel</span>
                <span className="text-[10px] text-mm-t2 ml-2 font-mono">coming soon</span>
              </div>
              <input
                type="checkbox"
                checked={false}
                readOnly
                disabled
                className="toggle toggle-primary toggle-sm opacity-40"
              />
            </div>
          </section>

          {/* ── Library ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Library</p>

            {/* Default view */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Default playlist view</span>
              <div className="flex gap-1">
                {([DefaultView.Tracks, DefaultView.History] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => updateSetting('defaultView', v)}
                    className={`btn btn-xs ${settings.defaultView === v ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Carousel size */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Carousel card size</span>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={120} max={240} step={10} value={settings.carouselSize}
                  onChange={e => updateSetting('carouselSize', Number(e.target.value))}
                  className="range range-primary range-xs w-36"
                />
                <span className="font-mono text-[10px] text-mm-t2 w-8">{settings.carouselSize}px</span>
              </div>
            </div>

          </section>

          {/* ── Identity ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Identity</p>

            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <div>
                <span className="text-xs text-mm-t1">Commit author name</span>
                <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Shown in playlist commit history</p>
              </div>
              <input
                type="text"
                value={settings.commitAuthor}
                onChange={e => updateSetting('commitAuthor', e.target.value)}
                placeholder="e.g. your username"
                className="input input-xs input-bordered bg-mm-2 text-mm-t0 w-36"
              />
            </div>
          </section>

          {/* ── Integrations ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Integrations</p>

            {/* Discord enable toggle */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <div>
                <span className="text-xs text-mm-t1">Discord Rich Presence</span>
                <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Show now-playing in Discord status</p>
              </div>
              <input
                type="checkbox"
                checked={settings.discordEnabled}
                onChange={e => updateSetting('discordEnabled', e.target.checked)}
                className="toggle toggle-primary toggle-sm"
              />
            </div>

            <div className="flex items-center justify-between py-2 border-t border-mm-b0">
              <div>
                <span className="text-xs text-mm-t1">Privacy Mode</span>
                <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Blur album art so others can't see what's playing</p>
              </div>
              <input
                type="checkbox"
                checked={settings.privacyMode}
                onChange={e => updateSetting('privacyMode', e.target.checked)}
                className="toggle toggle-primary toggle-sm"
              />
            </div>
          </section>

          {/* ── Sync ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Sync</p>

            {/* Online peers */}
            {livePeers.map(peer => (
              <div key={peer.public_key_b64} className="flex items-center justify-between py-1.5 px-2 rounded bg-mm-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  {editingKey === peer.public_key_b64 ? (
                    <input
                      ref={editInputRef}
                      className="input input-xs bg-mm-3 text-mm-t0 w-28"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => setEditingKey(null)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(peer.public_key_b64, editingName);
                        if (e.key === 'Escape') setEditingKey(null);
                      }}
                    />
                  ) : (
                    <span
                      className="text-xs text-mm-t0 cursor-pointer hover:text-mm-t1 truncate"
                      title="Click to rename"
                      onClick={() => { setEditingKey(peer.public_key_b64); setEditingName(peer.display_name); }}
                    >{peer.display_name}</span>
                  )}
                  {peer.latency_ms != null && (
                    <span className="font-mono text-[9px] text-mm-t2 shrink-0">{peer.latency_ms}ms</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn btn-xs btn-primary" onClick={() => openPeerManifest(peer)}>Sync</button>
                  <button
                    className="btn btn-xs btn-ghost text-[10px] text-mm-t2"
                    onClick={() => invoke('sync_remove_device', { publicKeyB64: peer.public_key_b64 }).then(refreshKnownDevices).catch(console.error)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Known but offline devices */}
            {offlineDevices.map(device => (
              <div key={device.public_key_b64} className="flex items-center justify-between py-1.5 px-2 rounded bg-mm-2 mb-1 opacity-50">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-mm-t3 shrink-0" />
                  {editingKey === device.public_key_b64 ? (
                    <input
                      ref={editingKey === device.public_key_b64 ? editInputRef : undefined}
                      className="input input-xs bg-mm-3 text-mm-t0 w-28"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => setEditingKey(null)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(device.public_key_b64, editingName);
                        if (e.key === 'Escape') setEditingKey(null);
                      }}
                    />
                  ) : (
                    <span
                      className="text-xs text-mm-t1 cursor-pointer hover:text-mm-t0 truncate"
                      title="Click to rename"
                      onClick={() => { setEditingKey(device.public_key_b64); setEditingName(device.display_name); }}
                    >{device.display_name}</span>
                  )}
                </div>
                <button
                  className="btn btn-xs btn-ghost text-[10px] text-mm-t2 shrink-0"
                  onClick={() => invoke('sync_remove_device', { publicKeyB64: device.public_key_b64 }).then(refreshKnownDevices).catch(console.error)}
                >
                  Remove
                </button>
              </div>
            ))}

            {/* Pair button */}
            <div className="flex items-center justify-between py-2 border-t border-mm-b0 mt-1">
              <div>
                <span className="text-xs text-mm-t1">Add a device</span>
                <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Sync playlists over LAN via QR pairing</p>
              </div>
              {onPairDevice && (
                <button onClick={onPairDevice} className="btn btn-xs btn-primary">
                  Pair a device
                </button>
              )}
            </div>
          </section>

          {/* ── About ── */}
          <section className="flex items-center justify-between">
            <div>
              <p className="text-xs text-mm-t1">Melomaniac v{__APP_VERSION__}</p>
              <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Tauri 2 · React · Rust · GPLv3</p>
            </div>
            <div className="flex items-center gap-2">
              {updateReady ? (
                <button onClick={onRelaunch} className="btn btn-primary btn-xs">
                  Relaunch
                </button>
              ) : pendingUpdate && (
                isInstalling ? (
                  <div className="flex items-center gap-2">
                    <progress
                      className="progress progress-primary w-20 h-1.5"
                      value={updateProgress ?? undefined}
                      max={100}
                    />
                    <span className="font-mono text-[10px] text-mm-t2">
                      {updateProgress != null ? `${updateProgress}%` : '…'}
                    </span>
                  </div>
                ) : (
                  <button onClick={onInstallUpdate} className="btn btn-primary btn-xs">
                    Update to v{pendingUpdate.version}
                  </button>
                )
              )}
              <button onClick={onReset} className="btn btn-ghost btn-xs">Reset to defaults</button>
            </div>
          </section>

        </div>
      </div>

      {/* Backdrop */}
      <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
    </dialog>
  );
}
