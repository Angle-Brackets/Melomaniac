import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ALBUMS, TRACKS, PLAYLISTS, trackRecordToTrack, playlistRecordToPlaylist } from './data';
import type { Track, Playlist, TrackRecord, PlaylistRecord } from './data';
import type { AppSettings, ShuffleMode } from './types';

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
import MiniPlayer from './components/MiniPlayer';
import QueuePanel from './components/QueuePanel';
import { FiPlay, FiPause } from 'react-icons/fi';

export type { AppSettings };

// ── Shuffle algorithms ────────────────────────────────────────────────────────
function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function balancedShuffle(tracks: import('./data').Track[]): import('./data').Track[] {
  const groups = new Map<string, import('./data').Track[]>();
  for (const t of tracks) {
    const key = t.artist || '?';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const shuffledGroups = [...groups.values()].map(g => fisherYates(g));
  const n = tracks.length;
  const result: { track: import('./data').Track; pos: number }[] = [];
  for (const group of shuffledGroups) {
    const spacing = n / group.length;
    const offset = Math.random() * spacing;
    group.forEach((t, i) => {
      result.push({ track: t, pos: offset + i * spacing + (Math.random() - 0.5) * spacing * 0.4 });
    });
  }
  result.sort((a, b) => a.pos - b.pos);
  return result.map(r => r.track);
}

function buildShuffledQueue(tracks: import('./data').Track[], mode: ShuffleMode): import('./data').Track[] {
  if (mode === 'balanced') return balancedShuffle(tracks);
  return fisherYates(tracks); // fisher-yates and random both produce a permutation; random re-rolls on every advance
}

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
  shuffleMode: 'fisher-yates',
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

  const [leftExpanded, setLeftExpanded] = useState(true);
  const [rightExpanded, setRightExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [rightPanelWidth, setRightPanelWidth] = useState(220);
  const [topPaneHeight, setTopPaneHeight] = useState(SETTING_DEFAULTS.carouselSize + 190);
  const [showCommitGraph, setShowCommitGraph] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showForkModal, setShowForkModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState('main');
  const [playlistRecords, setPlaylistRecords] = useState<PlaylistRecord[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[] | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [showArtworkModal, setShowArtworkModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{ message: string; execute: () => Promise<void> }[]>([]);
  const [railItem, setRailItem] = useState('playlists');
  const [activeTab, setActiveTab] = useState('Tracks');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [trackOrder, setTrackOrder] = useState<Track[]>(TRACKS);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [abA, setAbA] = useState(0);
  const [abB, setAbB] = useState(1);
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  // Keyed by track hash so points survive DB re-indexes and cross-device imports
  const [trackAbPoints, setTrackAbPoints] = useState<Record<string, { a: number; b: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.ab_points') ?? '{}'); } catch { return {}; }
  });
  const [folderPopupItem, setFolderPopupItem] = useState<Playlist | null>(null);
  const [folders, setFolders] = useState([{ id: 4, name: 'Gaming Sessions' }]);
  const [editorTrackId, setEditorTrackId] = useState<number | null>(null);
  const [activeTrackId, setActiveTrackId] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  // User-local favorites — persisted to localStorage, never committed to git
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('melomaniac.favorites') ?? '[]')); } catch { return new Set(); }
  });
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<Track[] | null>(null);
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const lastSeekTime = useRef(0);
  // Live position updated on every PositionChanged without triggering a re-render.
  // PlayerControls / MiniPlayer read this via rAF and update their DOM directly.
  const livePositionMsRef = useRef(0);
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const [volume, setVolume] = useState(0.30);
  const [miniPlayerCollapsed, setMiniPlayerCollapsed] = useState(false);
  const [manualQueue, setManualQueue] = useState<Track[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [vibeText, setVibeText] = useState('chill ambient music for focus');
  const [gitToast, setGitToast] = useState<string | null>(null);
  const [commitRefreshKey, setCommitRefreshKey] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [appStats, setAppStats] = useState<{ memory_mb: number; cpu_usage: number } | null>(null);

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

  // ── Stale-closure ref — updated synchronously each render so event handlers
  //    always read current values without being recreated.
  const sr = useRef({
    loopMode, playQueue, activeQueue, loadedHash, manualQueue,
    abA, abB, durationMs, positionMs, activeTrackId,
    isShuffle, shuffleMode: settings.shuffleMode,
  });
  sr.current.loopMode    = loopMode;
  sr.current.playQueue   = playQueue;
  sr.current.activeQueue = activeQueue;
  sr.current.loadedHash  = loadedHash;
  sr.current.manualQueue = manualQueue;
  sr.current.abA         = abA;
  sr.current.abB         = abB;
  sr.current.durationMs  = durationMs;
  sr.current.positionMs  = positionMs;
  sr.current.activeTrackId  = activeTrackId;
  sr.current.isShuffle      = isShuffle;
  sr.current.shuffleMode    = settings.shuffleMode;

  // Refs that hold the latest skip handlers so the audio event listener can
  // call them without stale closures.
  const skipNextRef = useRef<() => void>(() => {});
  const skipPrevRef = useRef<() => void>(() => {});

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
  // Track the previous playlist ID so we can distinguish a playlist change
  // (reset shuffle entirely) from a branch switch within the same playlist
  // (keep shuffle mode, rebuild the queue from the new branch's tracks).
  const prevPlaylistIdRef = useRef<string | null>(null);

  useEffect(() => {
    const playlistChanged = prevPlaylistIdRef.current !== activePlaylistId;
    prevPlaylistIdRef.current = activePlaylistId;

    if (playlistChanged) {
      setShuffledQueue(null);
      setIsShuffle(false);
    }

    if (!activePlaylistId) { setPlaylistTracks(null); return; }
    invoke<TrackRecord[]>('playlist_get_tracks', {
      playlistId: activePlaylistId,
      branchName: activeBranch,
    })
      .then(records => {
        const newTracks = records.map(trackRecordToTrack);
        setPlaylistTracks(newTracks);
        // Branch switch within same playlist — rebuild shuffled queue from new tracks
        if (!playlistChanged && newTracks.length > 0) {
          setShuffledQueue(q => q ? buildShuffledQueue(newTracks, sr.current.shuffleMode) : null);
        }
      })
      .catch(() => setPlaylistTracks([]));
  }, [activePlaylistId, activeBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Discord Rich Presence ─────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.discordEnabled) return;
    const track = trackOrder.find(t => t.hash === loadedHash);
    if (track) {
      invoke('discord_set_activity', {
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
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

    const loadTrack = (track: Track) => {
      setActiveTrackId(track.id);
      setLoadedHash(track.hash);
      setDurationMs(track.duration_ms);
      setPositionMs(0);
      livePositionMsRef.current = 0;
      setIsPlaying(true);
      invoke('track_play', { hash: track.hash }).catch(console.error);
    };

    let unlisten: (() => void) | undefined;
    listen<AudioPayload>('audio://event', ({ payload }) => {
      if (typeof payload === 'object' && 'PositionChanged' in payload) {
        const posMs = payload.PositionChanged;
        if (Date.now() - lastSeekTime.current > 600) {
          // Update the live ref — no React re-render; rAF in seek components reads it
          livePositionMsRef.current = posMs;
          sr.current.positionMs = posMs;
          // ── A·B loop enforcement ──────────────────────────────────────────
          const { loopMode: lm, abA: a, abB: b, durationMs: dur } = sr.current;
          if (lm === 'ab' && dur > 0 && posMs >= b * dur) {
            const aMs = Math.floor(a * dur);
            lastSeekTime.current = Date.now();
            livePositionMsRef.current = aMs;
            sr.current.positionMs = aMs;
            invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          }
        }
      }
      if (typeof payload === 'object' && 'DurationKnown' in payload) {
        if (payload.DurationKnown > 0) setDurationMs(payload.DurationKnown);
      }
      if (payload === 'TrackEnded') {
        setPositionMs(0);
        const { loopMode: lm, loadedHash: lh, abA: a, durationMs: dur } = sr.current;

        if (lm === 'one') {
          if (lh) invoke('track_play', { hash: lh }).catch(console.error);
          setIsPlaying(true);
          return;
        }
        if (lm === 'ab') {
          const aMs = Math.floor(a * dur);
          lastSeekTime.current = Date.now();
          setPositionMs(aMs);
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          invoke('audio_play').catch(console.error);
          setIsPlaying(true);
          return;
        }

        // loopMode 'off' — auto-advance
        const { manualQueue: mq, playQueue: pq, activeQueue: aq,
                isShuffle: shuffle, shuffleMode: sm, activeTrackId: atid } = sr.current;

        if (mq.length > 0) {
          const [next, ...rest] = mq;
          setManualQueue(rest);
          loadTrack(next);
          return;
        }

        let idx = pq.findIndex(t => t.hash === lh);
        if (idx === -1) idx = pq.findIndex(t => t.id === atid);

        const nextIdx = idx + 1;
        if (nextIdx >= pq.length) {
          // End of queue — reshuffle or wrap
          if (shuffle && aq.length > 0) {
            const newQ = buildShuffledQueue(aq, sm);
            if (newQ.length > 1 && newQ[0].hash === lh) [newQ[0], newQ[1]] = [newQ[1], newQ[0]];
            setShuffledQueue(newQ);
            loadTrack(newQ[0]);
          } else {
            const first = pq[0];
            if (first) loadTrack(first);
          }
        } else {
          loadTrack(pq[nextIdx]);
        }
      }
      if (payload === 'RemotePlay')  setIsPlaying(true);
      if (payload === 'RemotePause') setIsPlaying(false);
      if (payload === 'RemoteTogglePlayPause') setIsPlaying(p => !p);
      if (payload === 'RemoteNextTrack')     skipNextRef.current();
      if (payload === 'RemotePreviousTrack') skipPrevRef.current();
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Persist A·B points and favorites to localStorage ─────────────────────
  useEffect(() => {
    localStorage.setItem('melomaniac.ab_points', JSON.stringify(trackAbPoints));
  }, [trackAbPoints]);

  useEffect(() => {
    localStorage.setItem('melomaniac.favorites', JSON.stringify([...favorites]));
  }, [favorites]);

  // ── Sync A·B handles on track change ──────────────────────────────────────
  useEffect(() => {
    const hash = playQueue.find(t => t.id === activeTrackId)?.hash
               ?? trackOrder.find(t => t.id === activeTrackId)?.hash;
    const pts = hash ? trackAbPoints[hash] : undefined;
    if (pts) { setAbA(pts.a); setAbB(pts.b); }
    else { setAbA(0); setAbB(1); }
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

  const toast = (msg: string, ms = 1800) => {
    setGitToast(msg);
    setTimeout(() => setGitToast(null), ms);
  };

  // off → fisher-yates → balanced → random → off
  const handleShuffle = () => {
    if (!isShuffle) {
      updateSetting('shuffleMode', 'fisher-yates');
      setShuffledQueue(buildShuffledQueue(activeQueue, 'fisher-yates'));
      setIsShuffle(true);
      toast('Shuffle: True Shuffle');
    } else if (settings.shuffleMode === 'fisher-yates') {
      updateSetting('shuffleMode', 'balanced');
      setShuffledQueue(buildShuffledQueue(activeQueue, 'balanced'));
      toast('Shuffle: Balanced');
    } else if (settings.shuffleMode === 'balanced') {
      updateSetting('shuffleMode', 'random');
      setShuffledQueue(buildShuffledQueue(activeQueue, 'random'));
      toast('Shuffle: Random');
    } else {
      setShuffledQueue(null);
      setIsShuffle(false);
      toast('Shuffle: Off');
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
    const hash = playQueue.find(t => t.id === activeTrackId)?.hash
               ?? trackOrder.find(t => t.id === activeTrackId)?.hash;
    if (!hash) return;
    if (handle === 'A') {
      setAbA(val);
      setTrackAbPoints(p => ({ ...p, [hash]: { ...(p[hash] ?? { a: 0, b: 1 }), a: val } }));
    } else {
      setAbB(val);
      setTrackAbPoints(p => ({ ...p, [hash]: { ...(p[hash] ?? { a: 0, b: 1 }), b: val } }));
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
      commit: 'Committed snapshot → a3f891',
      push: 'Pushed to upstream/study-beats ✓',
      pull: 'Pulled 2 new tracks from remote',
      shuffle: 'Shuffled queue',
      branch: 'Branch created',
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
    if (track.hash === loadedHash) {
      // Already loaded — just toggle pause/resume
      if (isPlaying) {
        invoke('audio_pause').catch(console.error);
        setIsPlaying(false);
      } else {
        invoke('audio_play').catch(console.error);
        setIsPlaying(true);
      }
    } else {
      // Different track — load and play it
      setActiveTrackId(id);
      invoke('track_play', { hash: track.hash }).catch(console.error);
      setIsPlaying(true);
      setLoadedHash(track.hash);
    }
  };

  const handleSkipNext = () => {
    // Manual queue takes priority
    if (manualQueue.length > 0) {
      const [next, ...rest] = manualQueue;
      setManualQueue(rest);
      setActiveTrackId(next.id);
      invoke('track_play', { hash: next.hash }).catch(console.error);
      setIsPlaying(true);
      setLoadedHash(next.hash);
      setDurationMs(next.duration_ms);
      setPositionMs(0); livePositionMsRef.current = 0;
      return;
    }
    const q = playQueue;
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const nextIdx = (idx + 1) % q.length;
    const next = q[nextIdx];
    setActiveTrackId(next.id);
    invoke('track_play', { hash: next.hash }).catch(console.error);
    setIsPlaying(true);
    setLoadedHash(next.hash);
    setDurationMs(next.duration_ms);
    setPositionMs(0); livePositionMsRef.current = 0;
  };
  skipNextRef.current = handleSkipNext;

  const handleSkipPrev = () => {
    // Restart current track if more than 3 s in — reload is more reliable than seek-to-0
    if (livePositionMsRef.current > 3000 && loadedHash) {
      invoke('track_play', { hash: loadedHash }).catch(console.error);
      setPositionMs(0); livePositionMsRef.current = 0;
      setIsPlaying(true);
      return;
    }
    const q = playQueue;
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const prevIdx = (idx - 1 + q.length) % q.length;
    const prev = q[prevIdx];
    setActiveTrackId(prev.id);
    invoke('track_play', { hash: prev.hash }).catch(console.error);
    setIsPlaying(true);
    setLoadedHash(prev.hash);
    setDurationMs(prev.duration_ms);
    setPositionMs(0); livePositionMsRef.current = 0;
  };
  skipPrevRef.current = handleSkipPrev;

  const handlePlayPause = () => {
    // If audio is already loaded, toggle it — even if the current track isn't
    // in the active queue (e.g. switched to a branch that doesn't have it).
    if (loadedHash) {
      const queueTrack = playQueue.find(t => t.id === activeTrackId);
      if (!queueTrack || queueTrack.hash === loadedHash) {
        if (isPlaying) {
          invoke('audio_pause').catch(console.error);
          setIsPlaying(false);
        } else {
          invoke('audio_play').catch(console.error);
          setIsPlaying(true);
        }
        return;
      }
      // A different track is selected in the queue — load it
      invoke('track_play', { hash: queueTrack.hash }).catch(console.error);
      setLoadedHash(queueTrack.hash);
      setDurationMs(queueTrack.duration_ms);
      setPositionMs(0); livePositionMsRef.current = 0;
      setIsPlaying(true);
      return;
    }
    // Nothing loaded yet — load the selected track from the queue
    const track = playQueue.find(t => t.id === activeTrackId);
    if (!track?.hash) return;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    setLoadedHash(track.hash);
    setDurationMs(track.duration_ms);
    setPositionMs(0); livePositionMsRef.current = 0;
    setIsPlaying(true);
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
                        positionMsRef={livePositionMsRef}
                        durationMs={durationMs}
                        isPlaying={isPlaying} onPlayPause={handlePlayPause}
                        onSkipNext={handleSkipNext} onSkipPrev={handleSkipPrev}
                        isFav={favorites.has(playQueue.find(t => t.id === activeTrackId)?.hash ?? '')}
                        onFav={() => {
                          const hash = playQueue.find(t => t.id === activeTrackId)?.hash;
                          if (!hash) return;
                          setFavorites(prev => {
                            const next = new Set(prev);
                            next.has(hash) ? next.delete(hash) : next.add(hash);
                            return next;
                          });
                        }}
                        loopMode={loopMode} onLoopCycle={handleLoopCycle}
                        isShuffle={isShuffle} shuffleMode={settings.shuffleMode} onShuffle={handleShuffle}
                        showQueue={showQueue} onQueueToggle={() => setShowQueue(p => !p)}
                        onSeek={pct => {
                          const ms = Math.floor(pct * durationMs);
                          lastSeekTime.current = Date.now();
                          setPositionMs(ms); livePositionMsRef.current = ms;
                          invoke('audio_seek', { positionMs: ms }).catch(console.error);
                        }}
                        volume={volume} onVolume={v => { setVolume(v); invoke('audio_set_volume', { volume: v }).catch(console.error); }}
                        abA={abA} abB={abB} onAbChange={handleAbChange}
                      />
                    </div>
                    <ResizeHandle direction="v" onDelta={d => setTopPaneHeight(h => Math.max(settings.carouselSize + 160, Math.min(580, h + d)))} />
                    <TrackList
                      tracks={playlistTracks ?? trackOrder}
                      activeTrackId={activeTrackId}
                      loadedHash={loadedHash}
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
                      onPlayNext={track => { setManualQueue(q => [track, ...q]); toast(`"${track.title}" plays next`); }}
                      onAddToQueue={track => { setManualQueue(q => [...q, track]); toast(`"${track.title}" added to queue`); }}
                      favorites={favorites}
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

        {/* Queue panel */}
        {showQueue && (
          <QueuePanel
            playQueue={playQueue}
            manualQueue={manualQueue}
            loadedHash={loadedHash}
            artworkUrls={artworkUrls}
            onRemoveManual={idx => setManualQueue(q => q.filter((_, i) => i !== idx))}
            onClearManual={() => setManualQueue([])}
            onClose={() => setShowQueue(false)}
          />
        )}

        {/* Mini player */}
        {loadedHash && !miniPlayerCollapsed && (
          <MiniPlayer
            track={playQueue.find(t => t.hash === loadedHash) ?? null}
            artworkUrl={artworkUrls[loadedHash]}
            isPlaying={isPlaying}
            positionMsRef={livePositionMsRef}
            durationMs={durationMs}
            loopMode={loopMode}
            volume={volume}
            onPlayPause={handlePlayPause}
            onSkipNext={handleSkipNext}
            onSkipPrev={handleSkipPrev}
            onLoopCycle={handleLoopCycle}
            onSeek={pct => {
              const ms = Math.floor(pct * durationMs);
              lastSeekTime.current = Date.now();
              setPositionMs(ms); livePositionMsRef.current = ms;
              invoke('audio_seek', { positionMs: ms }).catch(console.error);
            }}
            onVolume={v => { setVolume(v); invoke('audio_set_volume', { volume: v }).catch(console.error); }}
            showQueue={showQueue} onQueueToggle={() => setShowQueue(p => !p)}
            onCollapse={() => setMiniPlayerCollapsed(true)}
            onStop={() => {
              invoke('audio_stop').catch(console.error);
              setIsPlaying(false);
              setLoadedHash(null);
              setPositionMs(0); livePositionMsRef.current = 0;
            }}
          />
        )}
        {loadedHash && miniPlayerCollapsed && (
          <div
            onClick={() => setMiniPlayerCollapsed(false)}
            style={{
              height: 22, flexShrink: 0,
              background: 'var(--bg-1)',
              borderTop: '1px solid var(--border-1)',
              display: 'flex', alignItems: 'center',
              padding: '0 12px', gap: 8,
              cursor: 'pointer',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-2)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-1)')}
            title="Expand player"
          >
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
              {playQueue.find(t => t.hash === loadedHash)?.title ?? '—'}
            </span>
            <span style={{ color: 'var(--text-3)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {isPlaying ? <FiPlay size={10} strokeWidth={2.5} /> : <FiPause size={11} strokeWidth={2} />}
            </span>
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
              <polyline points="2,6.5 5,3.5 8,6.5" />
            </svg>
          </div>
        )}

        {/* Status bar */}
        <div style={{
          height: 22, background: 'var(--bg-0)', borderTop: '1px solid var(--border-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', flexShrink: 0,
        }}>
          <span className="font-mono text-[9px] text-mm-t2">
            Melomaniac by Soupa | v0.1 Alpha | Rust + Tauri | GPLv3 | Syncing: <span style={{ color: 'var(--text-3)' }}>N/A</span>
            {showStats && appStats && (
              <span className="ml-4 text-mm-accent-lit">
                RAM: {appStats.memory_mb.toFixed(1)} MB | CPU: {appStats.cpu_usage.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="font-mono text-[9px] text-mm-t2">
            {(() => {
              const branch = activePlaylist?.branches.find(b => b.name === activeBranch);
              const head = branch?.head_commit?.slice(0, 7);
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
            position: 'absolute', bottom: loadedHash ? 92 : 30, left: '50%', transform: 'translateX(-50%)',
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
