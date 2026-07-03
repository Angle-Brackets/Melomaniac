import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isMac } from '../../shared/platform';

const appWindow = getCurrentWindow();

export default function TitleBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep the zoom button's tooltip/state in sync with the actual window state —
  // the user can also leave fullscreen via the native green-button hover menu
  // or Esc, not just by clicking this button again.
  useEffect(() => {
    if (!isMac) return;
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
    });
    return () => { unlisten.then(u => u()); };
  }, []);

  const handleZoom = () => {
    if (isMac) {
      // setFullscreen (not setSimpleFullscreen) gives the window its own macOS
      // Space, matching the native green-button behavior users expect.
      appWindow.setFullscreen(!isFullscreen).catch(() => {});
    } else {
      appWindow.toggleMaximize();
    }
  };

  const minimizeBtn = <button className="titlebar-btn" onClick={() => appWindow.minimize()} title="Minimize">—</button>;
  const zoomBtn = <button className="titlebar-btn" onClick={handleZoom} title={isMac ? 'Enter Full Screen' : 'Maximize'}>□</button>;
  const closeBtn = <button className="titlebar-btn titlebar-btn-close" onClick={() => appWindow.close()} title="Close">✕</button>;

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title">MELOMANIAC | The Melo Music Library | v{__APP_VERSION__}</div>
      <div style={{ [isMac ? 'marginRight' : 'marginLeft']: 'auto', display: 'flex', flexShrink: 0 }}>
        {isMac
          ? <>{closeBtn}{minimizeBtn}{zoomBtn}</>
          : <>{minimizeBtn}{zoomBtn}{closeBtn}</>}
      </div>
    </div>
  );
}
