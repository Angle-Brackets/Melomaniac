import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

export default function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title">MELOMANIAC | The Melo Music Library | v0.1 Alpha</div>
      <div style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
        <button className="titlebar-btn" onClick={() => appWindow.minimize()} title="Minimize">—</button>
        <button className="titlebar-btn" onClick={() => appWindow.toggleMaximize()} title="Maximize">□</button>
        <button className="titlebar-btn titlebar-btn-close" onClick={() => appWindow.close()} title="Close">✕</button>
      </div>
    </div>
  );
}
