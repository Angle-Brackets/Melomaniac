import { useState, useEffect, useMemo, useRef } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ALBUMS, TRACKS, PLAYLISTS, trackRecordToTrack } from './data';
import type { Track, Playlist, TrackRecord } from './data';
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
import ResizeHandle from './components/ResizeHandle';

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
  const [sidebarWidth,     setSidebarWidth]      = useState(220);
  const [rightPanelWidth,  setRightPanelWidth]   = useState(220);
  const [topPaneHeight,    setTopPaneHeight]      = useState(SETTING_DEFAULTS.carouselSize + 190);
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
  const [loadedHash,       setLoadedHash]        = useState<string | null>(null);
  const [positionMs,       setPositionMs]        = useState(0);
  const [durationMs,       setDurationMs]        = useState(0);
  const lastSeekTime = useRef(0);
  const [artworkUrls,      setArtworkUrls]       = useState<Record<string, string>>({});
  const [volume,           setVolume]            = useState(0.72);
  const [vibeText,         setVibeText]          = useState('chill ambient music for focus');
  const [gitToast,         setGitToast]          = useState<string | null>(null);
  const [showStats,        setShowStats]         = useState(false);
  const [appStats,         setAppStats]          = useState<{ memory_mb: number; cpu_usage: number } | null>(null);

  const playlist = PLAYLISTS[1];

  // Effective play order: shuffled queue when active, otherwise the playlist order
  const playQueue = useMemo(
    () => (isShuffle && shuffledQueue ? shuffledQueue : trackOrder),
    [isShuffle, shuffledQueue, trackOrder],
  );
  const carouselAlbums = useMemo(
    () => playQueue.map(t => ({
      ...(ALBUMS[t.albumRef] ?? ALBUMS[0]),
      artworkUrl: artworkUrls[t.hash] ?? null,
    })),
    [playQueue, artworkUrls],
  );
  const carouselIdx = Math.max(0, playQueue.findIndex(t => t.id === activeTrackId));

  // ── Theme effect — all palette logic lives in shared/themes.ts ──────────
  useEffect(() => {
    applyTheme(settings.theme, settings.accentHue);
  }, [settings.theme, settings.accentHue]);

  // Keep top pane tall enough whenever carousel size changes
  useEffect(() => {
    setTopPaneHeight(h => Math.max(h, settings.carouselSize + 190));
  }, [settings.carouselSize]);

  // Sync initial volume to the audio backend on mount
  useEffect(() => {
    invoke('audio_set_volume', { volume }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load real tracks from storage on mount ───────────────────────────────
  useEffect(() => {
    invoke<TrackRecord[]>('library_get_all')
      .then(records => {
        if (records.length > 0) {
          setTrackOrder(records.map(trackRecordToTrack));
        }
      })
      .catch(console.error);
  }, []);

  // ── Global Stats Listener ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        setShowStats(p => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!showStats) return;
    const fetchStats = () => {
      invoke<{ memory_mb: number; cpu_usage: number }>('get_system_stats')
        .then(setAppStats)
        .catch(console.error);
    };
    fetchStats();
    const interval = setInterval(fetchStats, 1000);
    return () => clearInterval(interval);
  }, [showStats]);

  // ── Audio event listener ─────────────────────────────────────────────────
  useEffect(() => {
    type AudioPayload =
      | 'TrackEnded' | 'RemotePlay' | 'RemotePause'
      | 'RemoteNextTrack' | 'RemotePreviousTrack' | 'RemoteTogglePlayPause'
      | { PositionChanged: number }
      | { DurationKnown: number }
      | { Error: string };

    let unlisten: (() => void) | undefined;
    listen<AudioPayload>('audio://event', ({ payload }) => {
      if (typeof payload === 'object' && 'PositionChanged' in payload) {
        // Ignore stale ticks for 600ms after a seek to prevent snap-back
        if (Date.now() - lastSeekTime.current > 600) {
          setPositionMs(payload.PositionChanged);
        }
      }
      if (typeof payload === 'object' && 'DurationKnown' in payload) {
        if (payload.DurationKnown > 0) setDurationMs(payload.DurationKnown);
      }
      if (payload === 'TrackEnded') {
        setIsPlaying(false);
        setPositionMs(0);
      }
      if (payload === 'RemotePlay')  setIsPlaying(true);
      if (payload === 'RemotePause') setIsPlaying(false);
      if (payload === 'RemoteTogglePlayPause') setIsPlaying(p => !p);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // ── Artwork prefetch — loads a window around the current carousel position ──
  // A ref tracks which hashes have been fetched/in-flight so we never
  const fetchedHashesRef = useRef(new Set<string>());
  useEffect(() => {
    for (const track of playQueue) {
      if (!track?.artwork_hash) continue;
      if (fetchedHashesRef.current.has(track.hash)) continue;
      fetchedHashesRef.current.add(track.hash);
      invoke<number[]>('track_get_artwork', { hash: track.hash })
        .then(bytes => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
          setArtworkUrls(prev => ({ ...prev, [track.hash]: url }));
        })
        .catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playQueue]);

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
    if (newOrder === null) {
      // Discard: restore the last committed state from the backend if available,
      // otherwise fall back to static mock data.
      invoke<TrackRecord[]>('library_get_all')
        .then(records => setTrackOrder(records.length > 0 ? records.map(trackRecordToTrack) : TRACKS))
        .catch(() => setTrackOrder(TRACKS));
      setHasUncommitted(false);
    } else {
      setTrackOrder(newOrder);
      setHasUncommitted(true);
    }
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
  };

  const handlePlayPause = () => {
    const track = playQueue.find(t => t.id === activeTrackId);
    if (!track?.hash) return;

    if (track.hash === loadedHash) {
      // Same track: toggle pause/resume
      if (isPlaying) {
        invoke('audio_pause').catch(console.error);
        setIsPlaying(false);
      } else {
        invoke('audio_play').catch(console.error);
        setIsPlaying(true);
      }
    } else {
      // New track: load and play
      invoke('track_play', { hash: track.hash }).catch(console.error);
      setLoadedHash(track.hash);
      setDurationMs(track.duration_ms);
      setPositionMs(0);
      setIsPlaying(true);
    }
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
            panelWidth={sidebarWidth}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onOpenSettings={() => setShowSettings(true)}
            onAddToFolderClick={setFolderPopupItem}
          />
          {leftExpanded && (
            <ResizeHandle direction="h" onDelta={d => setSidebarWidth(w => Math.max(140, Math.min(400, w + d)))} />
          )}

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
                    <div style={{ height: topPaneHeight, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                        track={playQueue.find(t => t.id === activeTrackId) ?? null}
                        positionMs={positionMs}
                        durationMs={durationMs}
                        isPlaying={isPlaying} onPlayPause={handlePlayPause}
                        isFav={isFav}         onFav={() => setIsFav(p => !p)}
                        loopMode={loopMode}   onLoopCycle={handleLoopCycle}
                        isShuffle={isShuffle} onShuffle={handleShuffle}
                        onSeek={pct => {
                          const ms = Math.floor(pct * durationMs);
                          lastSeekTime.current = Date.now();
                          setPositionMs(ms);
                          invoke('audio_seek', { positionMs: ms }).catch(console.error);
                        }}
                        volume={volume}       onVolume={v => { setVolume(v); invoke('audio_set_volume', { volume: v }).catch(console.error); }}
                        abA={abA} abB={abB}   onAbChange={handleAbChange}
                      />
                    </div>
                    <ResizeHandle direction="v" onDelta={d => setTopPaneHeight(h => Math.max(settings.carouselSize + 160, Math.min(580, h + d)))} />
                    <TrackList
                      tracks={trackOrder}
                      activeTrackId={activeTrackId}
                      onSelect={handleSelectTrack}
                      onReorder={handleReorder}
                      hasUncommitted={hasUncommitted}
                      onCommitChanges={handleCommitReorder}
                      onEditTrack={id => { setEditorTrackId(id); setRailItem('editor'); }}
                      artworkUrls={artworkUrls}
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
          {rightExpanded && settings.showRightPanel && (
            <ResizeHandle direction="h" onDelta={d => setRightPanelWidth(w => Math.max(160, Math.min(420, w - d)))} />
          )}
          <div style={{
            width: rightExpanded && settings.showRightPanel ? rightPanelWidth : 0,
            overflow: 'hidden',
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
            {showStats && appStats && (
              <span className="ml-4 text-mm-accent-lit">
                RAM: {appStats.memory_mb.toFixed(1)} MB | CPU: {appStats.cpu_usage.toFixed(1)}%
              </span>
            )}
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
