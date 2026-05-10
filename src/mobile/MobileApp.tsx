import { useState, useEffect } from 'react';
import './style.css';
import { applyTheme } from '../shared/themes';
import { NowPlaying } from './components/NowPlaying';
import { Library, PlaylistsList } from './components/Library';
import { PlaylistDetail } from './components/PlaylistDetail';
import { Discover } from './components/Discover';
import { Settings } from './components/Settings';
import type { TabId } from './components/common';

export default function MobileApp() {
  const [tab, setTab] = useState<TabId>('now');
  const [playlistDetailOpen, setPlaylistDetailOpen] = useState(false);

  // Apply warm theme on mount (mobile has no settings persistence yet)
  useEffect(() => { applyTheme('warm'); }, []);

  const handleTab = (id: TabId) => {
    setPlaylistDetailOpen(false);
    setTab(id);
  };

  const handlePlaylistDetail = () => setPlaylistDetailOpen(true);
  const handlePlaylistBack = () => setPlaylistDetailOpen(false);

  if (playlistDetailOpen) {
    return (
      <div className="mobile-root">
        <PlaylistDetail onBack={handlePlaylistBack} onTab={handleTab}/>
      </div>
    );
  }

  return (
    <div className="mobile-root">
      {tab === 'library'   && <Library onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
      {tab === 'playlists' && <PlaylistsList onTab={handleTab} onPlaylistDetail={handlePlaylistDetail}/>}
      {tab === 'now'       && <NowPlaying onTab={handleTab}/>}
      {tab === 'discover'  && <Discover onTab={handleTab}/>}
      {tab === 'settings'  && <Settings onTab={handleTab}/>}
    </div>
  );
}
