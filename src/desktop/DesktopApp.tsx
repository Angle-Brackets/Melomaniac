import { useState, useEffect, useMemo } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { ALBUMS, TRACKS, PLAYLISTS } from './data';
import type { Track, Playlist } from './data';
import type { AppSettings } from './types';

import TitleBar from './components/TitleBar';
import LibrarySidebar, { AddToFolderPopup } from './components/Sidebar';
import Carousel from './components/Carousel';
import PlaylistHeader from './components/PlaylistHeader';
import PlayerControls from './components/PlayerControls';
import type { LoopMode } from './components/PlayerControls';
import TrackList from './components/TrackList';
import RightPanel from './components/RightPanel';
import { CommitGraph, CommitGraphInline } from './components/CommitGraph';
import BranchModal from './components/BranchModal';
import SettingsModal from './components/SettingsModal';
import PlaylistSettingsPanel from './components/PlaylistSettingsPanel';
import EditorView from './components/EditorView';

export type { AppSettings };

// ── Default settings ──────────────────────────────────────────────────────────
const SETTING_DEFAULTS: AppSettings = {
  theme: 'warm',
  accentHue: 28,
  showRightPanel: true,
  carouselSize: 210,
  density: 'relaxed',
  defaultView: 'Tracks',
};

// Thin hook so the settings object stays in one place
function useSettings(defaults: AppSettings): [AppSettings, (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => void] {
  const [settings, setSettings] = useState<AppSettings>(defaults);
  const updateSetting = (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => {
    if (typeof key === 'object') {
      setSettings(prev => ({ ...prev, ...key }));
    } else {
      setSettings(prev => ({ ...prev, [key]: value }));
    }
  };
  return [settings, updateSetting];
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function DesktopApp() {
  const [settings, updateSetting] = useSettings(SETTING_DEFAULTS);

  const [leftExpanded,     setLeftExpanded]     = useState(true);
  const [rightExpanded,    setRightExpanded]     = useState(true);
  const [showCommitGraph,  setShowCommitGraph]   = useState(false);
  const [showSettings,     setShowSettings]      = useState(false);
  const [showBranchModal,  setShowBranchModal]   = useState(false);
  const [activePlaylistId, setActivePlaylistId]  = useState(2);
  const [railItem,         setRailItem]          = useState('library');
  const [activeTab,        setActiveTab]         = useState('Tracks');
  const [pinnedIds,        setPinnedIds]         = useState(new Set([2]));
  const [trackOrder,       setTrackOrder]        = useState<Track[]>(TRACKS);
  const [hasUncommitted,   setHasUncommitted]    = useState(false);
  const [abA,              setAbA]               = useState(0.2);
  const [abB,              setAbB]               = useState(0.7);
  const [loopMode,         setLoopMode]          = useState<LoopMode>('off');
  const [trackAbPoints,    setTrackAbPoints]     = useState<Record<number, { a: number; b: number }>>({ 1: { a: 0.2, b: 0.7 } });
  const [folderPopupItem,  setFolderPopupItem]   = useState<Playlist | null>(null);
  const [folders,          setFolders]           = useState([{ id: 4, name: 'Gaming Sessions' }]);
  const [editorTrackId,    setEditorTrackId]     = useState<number | null>(null);
  const [activeTrackId,    setActiveTrackId]     = useState(1);
  const [isPlaying,        setIsPlaying]         = useState(false);
  const [isFav,            setIsFav]             = useState(false);
  const [isShuffle,        setIsShuffle]         = useState(false);
  const [shuffledQueue,    setShuffledQueue]     = useState<Track[] | null>(null);
  const [seekPct,          setSeekPct]           = useState(0.18);
  const [volume,           setVolume]            = useState(0.72);
  const [vibeText,         setVibeText]          = useState('chill ambient music for focus');
  const [gitToast,         setGitToast]          = useState<string | null>(null);

  const playlist = PLAYLISTS[1];

  // Effective play order: shuffled queue when active, otherwise the playlist order
  const playQueue = useMemo(
    () => (isShuffle && shuffledQueue ? shuffledQueue : trackOrder),
    [isShuffle, shuffledQueue, trackOrder],
  );
  const carouselAlbums = useMemo(
    () => playQueue.map(t => ALBUMS[t.albumRef] ?? ALBUMS[0]),
    [playQueue],
  );
  const carouselIdx = Math.max(0, playQueue.findIndex(t => t.id === activeTrackId));

  // ── Theme effect — all palette logic lives in shared/themes.ts ──────────
  useEffect(() => {
    applyTheme(settings.theme, settings.accentHue);
  }, [settings.theme, settings.accentHue]);

  // ── Sync A·B handles on track change ──────────────────────────────────────
  useEffect(() => {
    const pts = trackAbPoints[activeTrackId];
    if (pts) { setAbA(pts.a); setAbB(pts.b); }
    else      { setAbA(0.2);  setAbB(0.7);   }
  }, [activeTrackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const togglePin = (id: number) => setPinnedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleReorder = (newOrder: Track[] | null) => {
    if (newOrder === null) { setTrackOrder(TRACKS); setHasUncommitted(false); }
    else { setTrackOrder(newOrder); setHasUncommitted(true); }
    // Manual reorder defines a new canonical order — clear any active shuffle queue
    if (shuffledQueue) { setShuffledQueue(null); setIsShuffle(false); }
  };

  const handleShuffle = () => {
    if (!isShuffle) {
      const shuffled = [...trackOrder].sort(() => Math.random() - 0.5);
      setShuffledQueue(shuffled);
      setIsShuffle(true);
    } else {
      setShuffledQueue(null);
      setIsShuffle(false);
    }
  };

  const handleCommitReorder = () => {
    handleGitAction('commit');
    setHasUncommitted(false);
  };

  const handleAbChange = (handle: 'A' | 'B', val: number) => {
    if (handle === 'A') {
      setAbA(val);
      setTrackAbPoints(p => ({ ...p, [activeTrackId]: { ...p[activeTrackId], a: val } }));
    } else {
      setAbB(val);
      setTrackAbPoints(p => ({ ...p, [activeTrackId]: { ...p[activeTrackId], b: val } }));
    }
  };

  const handleLoopCycle = () => setLoopMode(m => m === 'off' ? 'one' : m === 'one' ? 'ab' : 'off');

  // Intercept accent-hue changes: write to the CUSTOM slot and activate it.
  // Switching to a named theme resets accentHue to that theme's default.
  const handleUpdateSetting: typeof updateSetting = (key, value) => {
    if (key === 'accentHue' && typeof value === 'number') {
      const base = settings.theme !== 'custom' ? settings.theme as Exclude<ThemeName, 'custom'> : undefined;
      writeCustomHue(value, base);
      updateSetting({ theme: 'custom', accentHue: value });
    } else if (typeof key === 'object' && 'theme' in key && key.theme !== 'custom') {
      // Named theme selected — reset hue to that theme's default
      const themeName = key.theme as Exclude<ThemeName, 'custom'>;
      updateSetting({ ...key, accentHue: NAMED_THEMES[themeName].hue });
    } else {
      updateSetting(key, value);
    }
  };

  const handleGitAction = (action: string) => {
    const msgs: Record<string, string> = {
      commit:  'Committed snapshot → a3f891',
      push:    'Pushed to upstream/study-beats ✓',
      pull:    'Pulled 2 new tracks from remote',
      shuffle: 'Shuffled queue',
      branch:  'Branch created',
    };
    setGitToast(msgs[action] ?? action);
    setTimeout(() => setGitToast(null), 2400);
  };

  const handleRailChange = (item: string) => {
    setRailItem(item);
    if (item === 'git') setShowCommitGraph(true);
    if (item === 'editor') setActiveTab('Tracks');
  };

  const handleSelectTrack = (id: number) => {
    setActiveTrackId(id);
    setIsPlaying(true);
  };

  return (
    <div className="desktop-root">
      <div className="app-window">
        <TitleBar />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Sidebar */}
          <LibrarySidebar
            playlists={PLAYLISTS}
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={id => { setActivePlaylistId(id); setActiveTab('Tracks'); }}
            activeRailItem={railItem}
            onRailChange={handleRailChange}
            expanded={leftExpanded}
            onToggleExpanded={() => setLeftExpanded(p => !p)}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onOpenSettings={() => setShowSettings(true)}
            onAddToFolderClick={setFolderPopupItem}
          />

          {/* Center column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>
            {railItem === 'editor' ? (
              <EditorView track={TRACKS.find(t => t.id === (editorTrackId ?? activeTrackId ?? 1))} />
            ) : (
              <>
                <PlaylistHeader
                  playlist={playlist}
                  onGitAction={handleGitAction}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  isPinned={pinnedIds.has(playlist.id)}
                  onTogglePin={() => togglePin(playlist.id)}
                  onNewBranch={() => setShowBranchModal(true)}
                />

                {activeTab === 'Tracks' && (
                  <>
                    <div style={{ paddingTop: 14, paddingBottom: 4, flexShrink: 0 }}>
                      <Carousel
                        albums={carouselAlbums}
                        activeIndex={carouselIdx}
                        onIndexChange={idx => {
                          const t = playQueue[idx];
                          if (t) handleSelectTrack(t.id);
                        }}
                        size={settings.carouselSize}
                      />
                    </div>
                    <PlayerControls
                      isPlaying={isPlaying} onPlayPause={() => setIsPlaying(p => !p)}
                      isFav={isFav}         onFav={() => setIsFav(p => !p)}
                      loopMode={loopMode}   onLoopCycle={handleLoopCycle}
                      isShuffle={isShuffle} onShuffle={handleShuffle}
                      seekPct={seekPct}     onSeek={setSeekPct}
                      volume={volume}       onVolume={setVolume}
                      abA={abA} abB={abB}   onAbChange={handleAbChange}
                    />
                    <TrackList
                      tracks={trackOrder}
                      activeTrackId={activeTrackId}
                      onSelect={handleSelectTrack}
                      onReorder={handleReorder}
                      hasUncommitted={hasUncommitted}
                      onCommitChanges={handleCommitReorder}
                      onEditTrack={id => { setEditorTrackId(id); setRailItem('editor'); }}
                    />
                  </>
                )}

                {activeTab === 'History' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <CommitGraphInline />
                  </div>
                )}

                {activeTab === 'Settings' && (
                  <PlaylistSettingsPanel playlist={playlist} />
                )}
              </>
            )}
          </div>

          {/* Right panel — collapsible */}
          <div style={{
            width: rightExpanded && settings.showRightPanel ? 220 : 0,
            overflow: 'hidden',
            transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0, display: 'flex',
          }}>
            {settings.showRightPanel && (
              <RightPanel vibeText={vibeText} onVibeChange={setVibeText} onCollapse={() => setRightExpanded(false)} />
            )}
          </div>

          {/* Right panel re-open tab */}
          {(!rightExpanded || !settings.showRightPanel) && (
            <div
              onClick={() => setRightExpanded(true)}
              style={{
                position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                width: 18, height: 60, background: 'var(--bg-3)',
                borderLeft: '1px solid var(--border-1)',
                borderRadius: '6px 0 0 6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 10, color: 'var(--text-2)', fontSize: 10,
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-4)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-3)')}
            >‹</div>
          )}
        </div>

        {/* Status bar */}
        <div style={{
          height: 22, background: 'var(--bg-0)', borderTop: '1px solid var(--border-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', flexShrink: 0,
        }}>
          <span className="font-mono text-[9px] text-mm-t2">
            Melomaniac | Rust + Tauri | GPLv3 | Syncing: <span className="text-mm-green">Up-to-Date</span>
          </span>
          <span className="font-mono text-[9px] text-mm-t2">
            {trackOrder.length} tracks · branch: main · commit: 4fa9b0
          </span>
        </div>

        {/* ── Overlays ────────────────────────────────────────────────── */}

        {folderPopupItem && (
          <AddToFolderPopup
            item={folderPopupItem}
            folders={folders}
            onClose={() => setFolderPopupItem(null)}
            onAddToFolder={(_itemId, folderId) => {
              setGitToast(`Added to ${folders.find(f => f.id === folderId)?.name ?? 'folder'}`);
              setTimeout(() => setGitToast(null), 2400);
            }}
            onCreateFolder={(name, _itemId) => {
              setFolders(f => [...f, { id: Date.now(), name }]);
              setGitToast(`Folder '${name}' created`);
              setTimeout(() => setGitToast(null), 2400);
            }}
          />
        )}

        {showBranchModal && (
          <BranchModal
            onClose={() => setShowBranchModal(false)}
            onCreateBranch={(name, fromHash) => {
              handleGitAction('branch');
              setGitToast(`Branch '${name}' created from ${fromHash}`);
              setTimeout(() => setGitToast(null), 3000);
            }}
          />
        )}

        {showSettings && (
          <SettingsModal
            settings={settings}
            updateSetting={handleUpdateSetting}
            onClose={() => setShowSettings(false)}
            onReset={() => { updateSetting(SETTING_DEFAULTS); setShowSettings(false); }}
          />
        )}

        {showCommitGraph && (
          <CommitGraph onClose={() => { setShowCommitGraph(false); setRailItem('library'); }} />
        )}

        {/* Git operation toast */}
        {gitToast && (
          <div style={{
            position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-5)', border: '1px solid var(--border-2)',
            borderRadius: 6, padding: '7px 14px',
            fontSize: 11, color: 'var(--accent-light)',
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            pointerEvents: 'none', zIndex: 100,
            animation: 'fadeIn 0.2s ease',
          }}>{gitToast}</div>
        )}
      </div>
    </div>
  );
}
