import { useEffect } from 'react';
import type { AppSettings } from '../types';
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
}

const DENSITIES = ['compact', 'normal', 'relaxed'] as const;

export default function SettingsModal({ settings, updateSetting, onClose, onReset, onPairDevice, closing }: SettingsModalProps) {
  const livePeers           = useStore(s => s.livePeers);
  const knownDevices        = useStore(s => s.knownDevices);
  const refreshLivePeers    = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices = useStore(s => s.refreshKnownDevices);
  const openPeerManifest    = useStore(s => s.openPeerManifest);

  const liveKeys = new Set(livePeers.map(p => p.public_key_b64));
  const offlineDevices = knownDevices.filter(d => !liveKeys.has(d.public_key_b64));

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
                    onClick={() => updateSetting({ theme: key })}
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

            {/* Right panel — always on, not user-togglable */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0" title="AI & Metrics panel is always enabled">
              <div>
                <span className="text-xs text-mm-t1">Show AI & Metrics panel</span>
                <span className="text-[10px] text-mm-t2 ml-2 font-mono">always on</span>
              </div>
              <input
                type="checkbox"
                checked
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
                {(['Tracks', 'History'] as const).map(v => (
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
          </section>

          {/* ── Sync ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-mm-t2 mb-3">Sync</p>

            {/* Online peers */}
            {livePeers.map(peer => (
              <div key={peer.public_key_b64} className="flex items-center justify-between py-1.5 px-2 rounded bg-mm-2 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <span className="text-xs text-mm-t0">{peer.display_name}</span>
                  {peer.latency_ms != null && (
                    <span className="font-mono text-[9px] text-mm-t2">{peer.latency_ms}ms</span>
                  )}
                </div>
                <button className="btn btn-xs btn-primary" onClick={() => openPeerManifest(peer)}>Sync</button>
              </div>
            ))}

            {/* Known but offline devices */}
            {offlineDevices.map(device => (
              <div key={device.public_key_b64} className="flex items-center justify-between py-1.5 px-2 rounded bg-mm-2 mb-1 opacity-50">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-mm-t3 shrink-0" />
                  <span className="text-xs text-mm-t1">{device.display_name}</span>
                </div>
                <button
                  className="btn btn-xs btn-ghost text-[10px] text-mm-t2"
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
              <p className="text-xs text-mm-t1">Melomaniac v1.0 Alpha</p>
              <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Tauri 2 · React · Rust · GPLv3</p>
            </div>
            <button onClick={onReset} className="btn btn-ghost btn-xs">Reset to defaults</button>
          </section>

        </div>
      </div>

      {/* Backdrop */}
      <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
    </dialog>
  );
}
