import { useState, useEffect } from 'react';
import './style.css';

import { ALBUMS, TRACKS, PLAYLISTS } from './data';
import type { Track, Playlist } from './data';
import type { Tweaks } from './types';

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

// ── Tweaks ────────────────────────────────────────────────────────────────────
export type { Tweaks };

const TWEAK_DEFAULTS: Tweaks = {
  theme: 'warm',
  accentHue: 28,
  showRightPanel: true,
  carouselSize: 210,
  density: 'relaxed',
  defaultView: 'Tracks',
};

function useTweaks(defaults: Tweaks): [Tweaks, (key: keyof Tweaks | Partial<Tweaks>, value?: unknown) => void] {
  const [tweaks, setTweaks] = useState<Tweaks>(defaults);
  const setTweak = (key: keyof Tweaks | Partial<Tweaks>, value?: unknown) => {
    if (typeof key === 'object') {
      setTweaks(prev => ({ ...prev, ...key }));
    } else {
      setTweaks(prev => ({ ...prev, [key]: value }));
    }
  };
  return [tweaks, setTweak];
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function DesktopApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [leftExpanded, setLeftExpanded] = useState(true);
  const [rightExpanded, setRightExpanded] = useState(true);
  const [showCommitGraph, setShowCommitGraph] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState(2);
  const [railItem, setRailItem] = useState('library');
  const [activeTab, setActiveTab] = useState('Tracks');
  const [pinnedIds, setPinnedIds] = useState(new Set([2]));
  const [trackOrder, setTrackOrder] = useState<Track[]>(TRACKS);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [abA, setAbA] = useState(0.2);
  const [abB, setAbB] = useState(0.7);
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  const [trackAbPoints, setTrackAbPoints] = useState<Record<number, { a: number; b: number }>>({ 1: { a: 0.2, b: 0.7 } });
  const [folderPopupItem, setFolderPopupItem] = useState<Playlist | null>(null);
  const [folders, setFolders] = useState([{ id: 4, name: 'Gaming Sessions' }]);
  const [editorTrackId, setEditorTrackId] = useState<number | null>(null);
  const [carouselIdx, setCarouselIdx] = useState(1);
  const [activeTrackId, setActiveTrackId] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [seekPct, setSeekPct] = useState(0.18);
  const [volume, setVolume] = useState(0.72);
  const [vibeText, setVibeText] = useState('chill ambient music for focus');
  const [gitToast, setGitToast] = useState<string | null>(null);

  const playlist = PLAYLISTS[1];

  // ── Accent hue effect ─────────────────────────────────────────────────────
  useEffect(() => {
    const h = tweaks.accentHue;
    const root = document.documentElement;
    if (tweaks.theme === 'warm') {
      root.style.setProperty('--bg-0', `oklch(0.09 0.02 ${h})`);
      root.style.setProperty('--bg-1', `oklch(0.12 0.025 ${h})`);
      root.style.setProperty('--bg-2', `oklch(0.15 0.025 ${h})`);
      root.style.setProperty('--bg-3', `oklch(0.18 0.025 ${h})`);
      root.style.setProperty('--bg-4', `oklch(0.21 0.025 ${h})`);
      root.style.setProperty('--bg-5', `oklch(0.25 0.025 ${h})`);
    } else if (tweaks.theme === 'cool') {
      root.style.setProperty('--bg-0', `oklch(0.09 0.018 ${h})`);
      root.style.setProperty('--bg-1', `oklch(0.12 0.022 ${h})`);
      root.style.setProperty('--bg-2', `oklch(0.15 0.022 ${h})`);
      root.style.setProperty('--bg-3', `oklch(0.18 0.022 ${h})`);
      root.style.setProperty('--bg-4', `oklch(0.21 0.022 ${h})`);
      root.style.setProperty('--bg-5', `oklch(0.25 0.022 ${h})`);
    } else {
      root.style.setProperty('--bg-0', `oklch(0.08 0.015 ${h})`);
      root.style.setProperty('--bg-1', `oklch(0.11 0.018 ${h})`);
      root.style.setProperty('--bg-2', `oklch(0.14 0.018 ${h})`);
      root.style.setProperty('--bg-3', `oklch(0.17 0.018 ${h})`);
      root.style.setProperty('--bg-4', `oklch(0.20 0.018 ${h})`);
      root.style.setProperty('--bg-5', `oklch(0.24 0.018 ${h})`);
    }
    root.style.setProperty('--accent',       `oklch(0.62 0.15 ${h})`);
    root.style.setProperty('--accent-light', `oklch(0.72 0.14 ${h})`);
    root.style.setProperty('--accent-dim',   `oklch(0.38 0.1  ${h})`);
    root.style.setProperty('--border-0',     `oklch(0.18 0.025 ${h})`);
    root.style.setProperty('--border-1',     `oklch(0.22 0.03  ${h})`);
    root.style.setProperty('--border-2',     `oklch(0.30 0.04  ${h})`);
    root.style.setProperty('--text-1',       `oklch(0.62 0.06  ${h})`);
    root.style.setProperty('--text-2',       `oklch(0.48 0.05  ${h})`);
    root.style.setProperty('--text-3',       `oklch(0.35 0.04  ${h})`);
  }, [tweaks.theme, tweaks.accentHue]);

  // ── Sync A·B handles on track change ──────────────────────────────────────
  useEffect(() => {
    const pts = trackAbPoints[activeTrackId];
    if (pts) { setAbA(pts.a); setAbB(pts.b); }
    else { setAbA(0.2); setAbB(0.7); }
  }, [activeTrackId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const togglePin = (id: number) => setPinnedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleReorder = (newOrder: Track[] | null) => {
    if (newOrder === null) { setTrackOrder(TRACKS); setHasUncommitted(false); return; }
    setTrackOrder(newOrder);
    setHasUncommitted(true);
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

  const handleLoopCycle = () => {
    setLoopMode(m => {
      if (m === 'off') return 'one';
      if (m === 'one') return 'ab';
      return 'off';
    });
  };

  const handleGitAction = (action: string) => {
    const msgs: Record<string, string> = {
      commit: 'Committed snapshot → a3f891',
      push:   'Pushed to upstream/study-beats ✓',
      pull:   'Pulled 2 new tracks from remote',
      shuffle: 'Shuffled queue',
      branch:  'Branch created',
    };
    setGitToast(msgs[action] ?? action);
    setTimeout(() => setGitToast(null), 2400);
  };

  const handleRailChange = (item: string) => {
    setRailItem(item);
    if (item === 'git') { setShowCommitGraph(true); }
    if (item === 'editor') setActiveTab('Tracks');
  };

  const handleSelectTrack = (id: number) => {
    setActiveTrackId(id);
    setCarouselIdx(Math.max(0, Math.min(ALBUMS.length - 1, id - 1)));
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

          {/* Center */}
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
                        albums={ALBUMS}
                        activeIndex={carouselIdx}
                        onIndexChange={idx => { setCarouselIdx(idx); setActiveTrackId(idx + 1); }}
                      />
                    </div>
                    <PlayerControls
                      isPlaying={isPlaying} onPlayPause={() => setIsPlaying(p => !p)}
                      isFav={isFav} onFav={() => setIsFav(p => !p)}
                      loopMode={loopMode} onLoopCycle={handleLoopCycle}
                      isShuffle={isShuffle} onShuffle={() => setIsShuffle(p => !p)}
                      seekPct={seekPct} onSeek={setSeekPct}
                      volume={volume} onVolume={setVolume}
                      abA={abA} abB={abB}
                      onAbChange={handleAbChange}
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

          {/* Right panel */}
          <div style={{
            width: rightExpanded && tweaks.showRightPanel ? 220 : 0,
            overflow: 'hidden',
            transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0, display: 'flex',
          }}>
            {tweaks.showRightPanel && (
              <RightPanel vibeText={vibeText} onVibeChange={setVibeText} onCollapse={() => setRightExpanded(false)} />
            )}
          </div>

          {/* Right panel toggle tab */}
          {(!rightExpanded || !tweaks.showRightPanel) && (
            <div onClick={() => setRightExpanded(true)}
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
          <span style={{ fontSize: 9, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
            Melomaniac | Rust + Tauri | GPLv3 | Syncing: <span style={{ color: 'var(--green)' }}>Up-to-Date</span>
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
            {trackOrder.length} tracks · branch: main · commit: 4fa9b0
          </span>
        </div>

        {/* Folder popup */}
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

        {/* Branch modal */}
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

        {/* Settings modal */}
        {showSettings && (
          <SettingsModal
            tweaks={tweaks}
            setTweak={setTweak}
            onClose={() => setShowSettings(false)}
            onReset={() => { setTweak(TWEAK_DEFAULTS); setShowSettings(false); }}
          />
        )}

        {/* Commit graph modal */}
        {showCommitGraph && (
          <CommitGraph onClose={() => { setShowCommitGraph(false); setRailItem('library'); }} />
        )}

        {/* Git toast */}
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
