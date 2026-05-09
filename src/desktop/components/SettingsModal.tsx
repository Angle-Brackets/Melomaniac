import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../types';
import { NAMED_THEMES } from '../../shared/themes';
import type { ThemeName } from '../../shared/themes';

type NamedThemeName = Exclude<ThemeName, 'custom'>;
const NAMED_THEME_ENTRIES = Object.entries(NAMED_THEMES) as [NamedThemeName, typeof NAMED_THEMES[NamedThemeName]][];

interface SettingsModalProps {
  settings: AppSettings;
  updateSetting: (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => void;
  onClose: () => void;
  onReset: () => void;
}

const DENSITIES = ['compact', 'normal', 'relaxed'] as const;

export default function SettingsModal({ settings, updateSetting, onClose, onReset }: SettingsModalProps) {
  return (
    // DaisyUI modal — backdrop click closes
    <dialog className="modal modal-open" style={{ zIndex: 60 }}>
      <div className="modal-box bg-mm-1 border border-mm-b2 max-w-md p-0 overflow-hidden">

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

            {/* Right panel toggle */}
            <div className="flex items-center justify-between py-2 border-b border-mm-b0">
              <span className="text-xs text-mm-t1">Show AI & Metrics panel</span>
              <input
                type="checkbox"
                checked={settings.showRightPanel}
                onChange={e => updateSetting('showRightPanel', e.target.checked)}
                className="toggle toggle-primary toggle-sm"
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
                onChange={e => {
                  const enabled = e.target.checked;
                  updateSetting('discordEnabled', enabled);
                  invoke('discord_apply_settings', { enabled }).catch(console.error);
                }}
                className="toggle toggle-primary toggle-sm"
              />
            </div>
          </section>

          {/* ── About ── */}
          <section className="flex items-center justify-between">
            <div>
              <p className="text-xs text-mm-t1">Melomaniac v0.0.1-alpha</p>
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
