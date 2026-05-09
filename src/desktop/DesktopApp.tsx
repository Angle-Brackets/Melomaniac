import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ALBUMS, TRACKS, PLAYLISTS, trackRecordToTrack, playlistRecordToPlaylist } from './data';
import type { Track, Playlist, TrackRecord, PlaylistRecord } from './data';
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
import LibraryView from './components/LibraryView';
import ResizeHandle from './components/ResizeHandle';
import WindowResizeEdges from './components/WindowResizeEdges';
import NewPlaylistModal from './components/NewPlaylistModal';
import CommitBar from './components/CommitBar';
import PlaylistArtworkModal from './components/PlaylistArtworkModal';
import ForkPlaylistModal from './components/ForkPlaylistModal';
import MergeBranchModal from './components/MergeBranchModal';

export type { AppSettings };

// ── Default settings ──────────────────────────────────────────────────────────
const SETTING_DEFAULTS: AppSettings = {
  theme: 'warm',
  accentHue: 28,
  showRightPanel: false,
  carouselSize: 210,
  density: 'relaxed',
  defaultView: 'Tracks',
  discordEnabled: false,
  commitAuthor: '',
};

const SETTINGS_KEY = 'melomaniac.settings';

function loadSettings(defaults: AppSettings): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults;
}

function useSettings(defaults: AppSettings): [AppSettings, (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => void] {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(defaults));

  const updateSetting = (key: keyof AppSettings | Partial<AppSettings>, value?: unknown) => {
    setSettings(prev => {
      const next = typeof key === 'object'
        ? { ...prev, ...key }
        : { ...prev, [key]: value };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
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
  const [showForkModal,    setShowForkModal]     = useState(false);
  const [showMergeModal,   setShowMergeModal]    = useState(false);
  const [activePlaylistId, setActivePlaylistId]  = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState('main');
  const [playlistRecords,  setPlaylistRecords]   = useState<PlaylistRecord[]>([]);
  const [playlistTracks,   setPlaylistTracks]    = useState<Track[] | null>(null);
  const [showNewPlaylist,  setShowNewPlaylist]   = useState(false);
  const [showArtworkModal, setShowArtworkModal]  = useState(false);
  const [pendingChanges,   setPendingChanges]    = useState<{ message: string; execute: () => Promise<void> }[]>([]);
  const [railItem,         setRailItem]          = useState('playlists');
  const [activeTab,        setActiveTab]         = useState('Tracks');
  const [pinnedIds,        setPinnedIds]         = useState<Set<string>>(new Set());
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
  const [commitRefreshKey, setCommitRefreshKey]  = useState(0);
  const [showStats,        setShowStats]         = useState(false);
  const [appStats,         setAppStats]          = useState<{ memory_mb: number; cpu_usage: number } | null>(null);

  const activePlaylist = playlistRecords.find(p => p.id === activePlaylistId) ?? null;
  // Fall back to first mock for the playlist header when no real playlist is selected
  const playlistForHeader = activePlaylist ?? null;

  // When a playlist is selected, the queue is its tracks; otherwise fall back to
  // the full library so the carousel is never empty.
  const activeQueue = useMemo(
    () => playlistTracks ?? trackOrder,
    [playlistTracks, trackOrder],
  );
  const playQueue = useMemo(
    () => (isShuffle && shuffledQueue ? shuffledQueue : activeQueue),
    [isShuffle, shuffledQueue, activeQueue],
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

  // Fetch the persisted commit author name from the backend on mount
  useEffect(() => {
    invoke<string>('get_commit_author')
      .then(name => { if (name) updateSetting('commitAuthor', name); })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push commit author changes to the backend whenever the setting is updated
  useEffect(() => {
    if (settings.commitAuthor) {
      invoke('set_commit_author', { name: settings.commitAuthor }).catch(console.error);
    }
  }, [settings.commitAuthor]);

  // ── Load real tracks from storage on mount ───────────────────────────────
  const reloadLibrary = useCallback(() => {
    invoke<TrackRecord[]>('library_get_all')
      .then(records => { if (records.length > 0) setTrackOrder(records.map(trackRecordToTrack)); })
      .catch(console.error);
  }, []);

  useEffect(() => { reloadLibrary(); }, []);

  // ── Refresh library when a download completes ────────────────────────────
  useEffect(() => {
    const unsub = listen('download://done', () => reloadLibrary());
    return () => { unsub.then(fn => fn()); };
  }, [reloadLibrary]);

  // ── Load real playlists from backend ─────────────────────────────────────
  const reloadPlaylists = useCallback(() => {
    invoke<PlaylistRecord[]>('playlist_get_all')
      .then(setPlaylistRecords)
      .catch(console.error);
  }, []);

  useEffect(() => { reloadPlaylists(); }, []);

  // ── Reset branch when switching playlists ────────────────────────────────
  useEffect(() => {
    if (!activePlaylist) return;
    const hasCurrent = activePlaylist.branches.some(b => b.name === activeBranch);
    if (!hasCurrent) {
      const fallback = activePlaylist.branches.find(b => b.name === 'main') ?? activePlaylist.branches[0];
      if (fallback) setActiveBranch(fallback.name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylistId]);

  // ── Load tracks for the active playlist ──────────────────────────────────
  useEffect(() => {
    // Clear shuffle state when the source changes so the queue doesn't carry
    // over tracks from a previous playlist into the new one.
    setShuffledQueue(null);
    setIsShuffle(false);

    if (!activePlaylistId) { setPlaylistTracks(null); return; }
    invoke<TrackRecord[]>('playlist_get_tracks', {
      playlistId:  activePlaylistId,
      branchName: activeBranch,
    })
      .then(records => setPlaylistTracks(records.map(trackRecordToTrack)))
      .catch(() => setPlaylistTracks([]));
  }, [activePlaylistId, activeBranch]);

  // ── Discord Rich Presence ─────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.discordEnabled) return;
    const track = trackOrder.find(t => t.hash === loadedHash);
    if (track) {
      invoke('discord_set_activity', {
        title:  track.title,
        artist: track.artist,
        album:  track.album ?? null,
      }).catch(console.error);
    } else {
      invoke('discord_clear_activity').catch(console.error);
    }
  }, [loadedHash, settings.discordEnabled]);

  // ── Global Stats Listener ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        setShowStats(p => !p);
      }
      // Dev-only: Ctrl+Shift+Backspace wipes all playlists and commit history
      if (import.meta.env.DEV && e.ctrlKey && e.shiftKey && e.key === 'Backspace') {
        invoke('dev_reset_playlists')
          .then(() => {
            setPlaylistRecords([]);
            setActivePlaylistId(null);
            setPlaylistTracks(null);
            setPendingChanges([]);
            setGitToast('Dev reset: all playlists cleared');
            setTimeout(() => setGitToast(null), 2400);
          })
          .catch(console.error);
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

  // ── Load artwork for the active playlist branch ───────────────────────────
  useEffect(() => {
    if (!activePlaylist) return;
    const key = `pl_${activePlaylist.id}::${activeBranch}`;
    if (artworkUrls[key]) return;
    invoke<number[]>('playlist_get_artwork', { playlistId: activePlaylist.id, branchName: activeBranch })
      .then(bytes => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        setArtworkUrls(prev => ({ ...prev, [key]: url }));
      })
      .catch(() => {
        // Branch has no artwork — mark as empty so we don't retry
        setArtworkUrls(prev => ({ ...prev, [key]: '' }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylist?.id, activeBranch]);

  // ── Sync A·B handles on track change ──────────────────────────────────────
  useEffect(() => {
    const pts = trackAbPoints[activeTrackId];
    if (pts) { setAbA(pts.a); setAbB(pts.b); }
    else      { setAbA(0.2);  setAbB(0.7);   }
  }, [activeTrackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const togglePin = (id: string) => setPinnedIds(prev => {
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
      const shuffled = [...activeQueue].sort(() => Math.random() - 0.5);
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

  const handlePlaylistReorder = useCallback(async (newOrder: Track[] | null) => {
    if (!activePlaylistId) return;
    if (newOrder === null) {
      // Discard: reload from backend
      invoke<TrackRecord[]>('playlist_get_tracks', { playlistId: activePlaylistId, branchName: activeBranch })
        .then(r => setPlaylistTracks(r.map(trackRecordToTrack))).catch(console.error);
      return;
    }
    const hashes = newOrder.map(t => t.hash);
    try {
      await invoke('playlist_reorder_tracks', { playlistId: activePlaylistId, branchName: activeBranch, orderedHashes: hashes });
      setPlaylistTracks(newOrder);
      setCommitRefreshKey(k => k + 1);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, activeBranch]);

  const handleRemoveFromPlaylist = useCallback(async (hash: string) => {
    if (!activePlaylistId) return;
    const title = playlistTracks?.find(t => t.hash === hash)?.title ?? hash.slice(0, 7);
    try {
      await invoke('playlist_remove_track', { playlistId: activePlaylistId, branchName: activeBranch, hash, message: `Remove: ${title}` });
      setPlaylistTracks(prev => prev ? prev.filter(t => t.hash !== hash) : null);
      setCommitRefreshKey(k => k + 1);
      setGitToast(`Removed "${title}"`);
      setTimeout(() => setGitToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, activeBranch, playlistTracks]);

  const handleDeletePlaylist = useCallback(async () => {
    if (!activePlaylistId) return;
    const name = playlistRecords.find(p => p.id === activePlaylistId)?.name ?? 'playlist';
    try {
      await invoke('playlist_delete', { playlistId: activePlaylistId });
      setPlaylistRecords(prev => prev.filter(p => p.id !== activePlaylistId));
      setActivePlaylistId(null);
      setPlaylistTracks(null);
      setActiveTab('Tracks');
      setGitToast(`Deleted "${name}"`);
      setTimeout(() => setGitToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, playlistRecords]);

  const handleRenamePlaylist = useCallback(async (newName: string) => {
    if (!activePlaylistId) return;
    try {
      await invoke('playlist_rename', { playlistId: activePlaylistId, branchName: activeBranch, newName, message: '' });
      reloadPlaylists();
      setCommitRefreshKey(k => k + 1);
      setGitToast(`Renamed to "${newName}"`);
      setTimeout(() => setGitToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, activeBranch, reloadPlaylists]);

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

  const handleTrackPlayPause = (id: number) => {
    const track = playQueue.find(t => t.id === id);
    if (!track?.hash) return;
    if (id !== activeTrackId) {
      // Different track — select and play it
      setActiveTrackId(id);
      invoke('track_play', { hash: track.hash }).catch(console.error);
      setIsPlaying(true);
      setLoadedHash(track.hash);
    } else if (isPlaying) {
      invoke('audio_pause').catch(console.error);
      setIsPlaying(false);
    } else {
      invoke('audio_play').catch(console.error);
      setIsPlaying(true);
    }
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
      <WindowResizeEdges />
      <div className="app-window">
        <TitleBar />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Sidebar */}
          <LibrarySidebar
            playlists={playlistRecords.length > 0 ? playlistRecords.map(playlistRecordToPlaylist) : PLAYLISTS}
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={id => { setActivePlaylistId(id); setActiveTab('Tracks'); setRailItem('playlists'); }}
            activeRailItem={railItem}
            onRailChange={handleRailChange}
            expanded={leftExpanded}
            onToggleExpanded={() => setLeftExpanded(p => !p)}
            panelWidth={sidebarWidth}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onOpenSettings={() => setShowSettings(true)}
            onAddToFolderClick={setFolderPopupItem}
            onNewPlaylist={() => setShowNewPlaylist(true)}
          />
          {leftExpanded && (
            <ResizeHandle direction="h" onDelta={d => setSidebarWidth(w => Math.max(140, Math.min(400, w + d)))} />
          )}

          {/* Center column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>
            {railItem === 'library' ? (
              <LibraryView
                artworkUrls={artworkUrls}
                onOpenInEditor={hash => { setEditorTrackId(trackOrder.find(t => t.hash === hash)?.id ?? null); setRailItem('editor'); }}
                onTracksChanged={setTrackOrder}
                defaultPlaylistId={activePlaylistId}
                defaultBranchName={activeBranch}
                onTracksAddedToPlaylist={(playlistId, branchName, count) => {
                  const plName = playlistRecords.find(p => p.id === playlistId)?.name ?? 'playlist';
                  setGitToast(`Added ${count} ${count === 1 ? 'track' : 'tracks'} to "${plName}"`);
                  setTimeout(() => setGitToast(null), 2400);
                  if (playlistId === activePlaylistId && branchName === activeBranch) {
                    invoke<TrackRecord[]>('playlist_get_tracks', { playlistId, branchName })
                      .then(r => setPlaylistTracks(r.map(trackRecordToTrack)))
                      .catch(console.error);
                  }
                  setCommitRefreshKey(k => k + 1);
                }}
              />
            ) : railItem === 'editor' ? (
              <EditorView
                track={trackOrder.find(t => t.id === (editorTrackId ?? activeTrackId))}
                tracks={trackOrder}
                artworkUrls={artworkUrls}
                onTrackUpdated={(oldHash, newHash, patch) => {
                  // Targeted in-place patch — only the one changed track
                  setTrackOrder(prev => prev.map(t =>
                    t.hash === oldHash
                      ? { ...t, hash: newHash, title: patch.title, artist: patch.artist, album: patch.album }
                      : t
                  ));
                  // Move artwork URL to the new hash (blob unchanged)
                  setArtworkUrls(prev => {
                    const url = prev[oldHash];
                    if (!url) return prev;
                    const next = { ...prev, [newHash]: url };
                    delete next[oldHash];
                    return next;
                  });
                  fetchedHashesRef.current.add(newHash);
                  fetchedHashesRef.current.delete(oldHash);
                  if (loadedHash === oldHash) setLoadedHash(newHash);
                  setGitToast('Metadata saved · committed to all branches');
                  setTimeout(() => setGitToast(null), 3000);
                  setCommitRefreshKey(k => k + 1);
                }}
                onArtworkUpdated={(affectedHashes, newUrl) => {
                  setArtworkUrls(prev => {
                    const next = { ...prev };
                    for (const h of affectedHashes) next[h] = newUrl;
                    return next;
                  });
                  const n = affectedHashes.length;
                  const msg = n === 1
                    ? `Artwork updated · ${trackOrder.find(t => t.hash === affectedHashes[0])?.title ?? affectedHashes[0].slice(0, 6)}`
                    : `Artwork updated · ${n} tracks`;
                  setGitToast(msg);
                  setTimeout(() => setGitToast(null), 3000);
                  setCommitRefreshKey(k => k + 1);
                }}
                onTrackDeleted={hash => setTrackOrder(prev => prev.filter(t => t.hash !== hash))}
              />
            ) : (
              <>
                <PlaylistHeader
                  playlist={playlistForHeader}
                  artworkUrl={artworkUrls[`pl_${activePlaylist?.id}::${activeBranch}`] || null}
                  activeBranch={activeBranch}
                  onBranchChange={name => { setActiveBranch(name); setCommitRefreshKey(k => k + 1); }}
                  onGitAction={handleGitAction}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  isPinned={activePlaylistId ? pinnedIds.has(activePlaylistId) : false}
                  onTogglePin={() => { if (activePlaylistId) togglePin(activePlaylistId); }}
                  onNewBranch={() => setShowBranchModal(true)}
                  onMerge={() => setShowMergeModal(true)}
                  onFork={() => setShowForkModal(true)}
                  onEditArtwork={() => setShowArtworkModal(true)}
                  onBranchesChanged={reloadPlaylists}
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
                      tracks={playlistTracks ?? trackOrder}
                      activeTrackId={activeTrackId}
                      isPlaying={isPlaying}
                      onSelect={handleSelectTrack}
                      onPlayPause={handleTrackPlayPause}
                      onReorder={playlistTracks ? handlePlaylistReorder : handleReorder}
                      hasUncommitted={hasUncommitted}
                      onCommitChanges={handleCommitReorder}
                      onEditTrack={id => { setEditorTrackId(id); setRailItem('editor'); }}
                      artworkUrls={artworkUrls}
                      onRemoveTrack={playlistTracks ? handleRemoveFromPlaylist : undefined}
                      onAddTracks={playlistTracks ? () => {
                        setRailItem('library');
                        setGitToast('Select tracks in the library, then use "Add to Playlist"');
                        setTimeout(() => setGitToast(null), 3000);
                      } : undefined}
                      density={settings.density}
                    />
                  </>
                )}

                {activeTab === 'History' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <CommitGraphInline
                      playlistId={activePlaylistId}
                      branchName={activeBranch}
                      refreshKey={commitRefreshKey}
                      onBranchCreated={(name, pid) => {
                        reloadPlaylists();
                        if (pid === activePlaylistId) {
                          setActiveBranch(name);
                        }
                        setCommitRefreshKey(k => k + 1);
                      }}
                      onRevertTo={(_hash, pid) => {
                        setCommitRefreshKey(k => k + 1);
                        const resolvedId = pid ?? activePlaylistId;
                        if (resolvedId) {
                          invoke<TrackRecord[]>('playlist_get_tracks', {
                            playlistId: resolvedId, branchName: activeBranch,
                          }).then(r => setPlaylistTracks(r.map(trackRecordToTrack))).catch(console.error);
                        }
                      }}
                    />
                  </div>
                )}

                {activeTab === 'Settings' && (
                  <PlaylistSettingsPanel
                    playlist={playlistForHeader}
                    onDelete={handleDeletePlaylist}
                    onRename={handleRenamePlaylist}
                  />
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
            {(() => {
              const branch = activePlaylist?.branches.find(b => b.name === activeBranch);
              const head   = branch?.head_commit?.slice(0, 7);
              if (activePlaylist) {
                return `${playlistTracks?.length ?? 0} tracks · ${activePlaylist.name} · ${activeBranch}${head ? ` · ${head}` : ''}`;
              }
              return `${trackOrder.length} tracks · library`;
            })()}
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

        {showArtworkModal && activePlaylist && (
          <PlaylistArtworkModal
            playlistId={activePlaylist.id}
            branchName={activeBranch}
            currentArtworkUrl={artworkUrls[`pl_${activePlaylist.id}::${activeBranch}`] || null}
            onSaved={(newUrl) => {
              const key = `pl_${activePlaylist.id}::${activeBranch}`;
              setArtworkUrls(prev => ({ ...prev, [key]: newUrl }));
              reloadPlaylists();
              setShowArtworkModal(false);
              setGitToast('Playlist artwork updated');
              setTimeout(() => setGitToast(null), 2400);
            }}
            onClose={() => setShowArtworkModal(false)}
          />
        )}

        {showNewPlaylist && (
          <NewPlaylistModal
            onClose={() => setShowNewPlaylist(false)}
            onCreate={(playlist) => {
              setPlaylistRecords(prev => [...prev, playlist]);
              setActivePlaylistId(playlist.id);
              setRailItem('playlists');
              setShowNewPlaylist(false);
            }}
          />
        )}

        {pendingChanges.length > 0 && activePlaylistId && (
          <CommitBar
            changes={pendingChanges}
            onCommit={async (edited) => {
              for (let i = 0; i < edited.length; i++) {
                pendingChanges[i] && await pendingChanges[i].execute();
              }
              setPendingChanges([]);
              // Reload playlist tracks after commit
              invoke<TrackRecord[]>('playlist_get_tracks', {
                playlistId: activePlaylistId, branchName: activeBranch,
              }).then(r => setPlaylistTracks(r.map(trackRecordToTrack))).catch(console.error);
            }}
            onDiscard={() => setPendingChanges([])}
          />
        )}


        {showMergeModal && activePlaylist && (
          <MergeBranchModal
            playlist={activePlaylist}
            targetBranch={activeBranch}
            targetTrackHashes={(playlistTracks ?? []).map(t => t.hash)}
            onClose={() => setShowMergeModal(false)}
            onMerged={commitHash => {
              setShowMergeModal(false);
              reloadPlaylists();
              invoke<TrackRecord[]>('playlist_get_tracks', {
                playlistId: activePlaylist.id, branchName: activeBranch,
              }).then(r => setPlaylistTracks(r.map(trackRecordToTrack))).catch(console.error);
              setCommitRefreshKey(k => k + 1);
              setGitToast(`Merged into '${activeBranch}' · ${commitHash.slice(0, 7)}`);
              setTimeout(() => setGitToast(null), 2800);
            }}
          />
        )}

        {showForkModal && activePlaylist && (
          <ForkPlaylistModal
            source={activePlaylist}
            onClose={() => setShowForkModal(false)}
            onForked={newPlaylist => {
              setShowForkModal(false);
              reloadPlaylists();
              setActivePlaylistId(newPlaylist.id);
              setActiveBranch('main');
              setGitToast(`Forked to '${newPlaylist.name}'`);
              setTimeout(() => setGitToast(null), 2400);
            }}
          />
        )}

        {showBranchModal && activePlaylist && (
          <BranchModal
            playlistId={activePlaylist.id}
            playlistName={activePlaylist.name}
            branchName={activeBranch}
            onClose={() => setShowBranchModal(false)}
            onCreate={name => {
              reloadPlaylists();
              setActiveBranch(name);
              setCommitRefreshKey(k => k + 1);
              setGitToast(`Branch '${name}' created`);
              setTimeout(() => setGitToast(null), 2400);
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
          <CommitGraph onClose={() => { setShowCommitGraph(false); setRailItem('playlists'); }} />
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
