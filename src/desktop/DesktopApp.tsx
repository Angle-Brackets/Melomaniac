import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check as checkForUpdate } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { useAccentsFromUrl, useGlowFade, withAlpha } from '../shared/artworkAccents';
import { ALBUMS, trackRecordToTrack, playlistRecordToPlaylist } from './data';
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
import { useAnimatedMount } from './hooks/useAnimatedMount';
import { DiffViewer } from '../components/DiffViewer';
import { PairingModal } from '../components/PairingModal';
import { PeerPlaylistsModal } from '../components/PeerPlaylistsModal';
import StatsView from './components/StatsView';
import { useStore } from '../store';

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

const ARTIST_PENALTY    = 0.25;
const ARTIST_LOOKBEHIND = 4;

function smartShuffle(tracks: Track[]): Track[] {
  type Candidate = { track: Track; artist: string };
  const pool: Candidate[] = tracks.map(t => ({ track: t, artist: t.artist || '?' }));
  const result: Track[] = [];
  const recentArtists: string[] = [];

  while (pool.length > 0) {
    const freq = new Map<string, number>();
    for (const a of recentArtists.slice(-ARTIST_LOOKBEHIND)) {
      freq.set(a, (freq.get(a) ?? 0) + 1);
    }
    const weights = pool.map(c => Math.pow(ARTIST_PENALTY, freq.get(c.artist) ?? 0));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) { r -= weights[j]; if (r <= 0) { idx = j; break; } }
    result.push(pool[idx].track);
    recentArtists.push(pool[idx].artist);
    pool.splice(idx, 1);
  }
  return result;
}

function buildShuffledQueue(tracks: Track[], mode: ShuffleMode): Track[] {
  if (mode === 'smart') return smartShuffle(tracks);
  return fisherYates(tracks);
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
export default function DesktopApp(): JSX.Element {
  const openPairingDisplay       = useStore(s => s.openPairingDisplay);
  const syncToast                = useStore(s => s.syncToast);
  const refreshLivePeers         = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices      = useStore(s => s.refreshKnownDevices);
  const loadPlaylists            = useStore(s => s.loadPlaylists);
  const artworkVersion           = useStore(s => s.artworkVersion);
  const syncVersion              = useStore(s => s.syncVersion);
  const pendingConflictPlaylists = useStore(s => s.pendingConflictPlaylists);
  const reopenConflict           = useStore(s => s.reopenConflict);
  const isPlaying  = useStore(s => s.isPlaying);
  const loadedHash = useStore(s => s.loadedTrackHash);
  const durationMs = useStore(s => s.duration_ms);
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

  const commitGraphAnim = useAnimatedMount(showCommitGraph);
  const settingsAnim    = useAnimatedMount(showSettings);
  const branchAnim      = useAnimatedMount(showBranchModal);
  const forkAnim        = useAnimatedMount(showForkModal);
  const mergeAnim       = useAnimatedMount(showMergeModal);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState('main');
  const [playlistRecords, setPlaylistRecords] = useState<PlaylistRecord[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[] | null>(null);
  const [branchMeta, setBranchMeta] = useState<{ description: string | null } | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [showArtworkModal, setShowArtworkModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{ message: string; execute: () => Promise<void> }[]>([]);
  const [railItem, setRailItem] = useState('playlists');
  const [activeTab, setActiveTab] = useState('Tracks');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('melomaniac.pinned') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const [trackOrder, setTrackOrder] = useState<Track[]>([]);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [abA, setAbA] = useState(0);
  const [abB, setAbB] = useState(1);
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  // Keyed by track hash so points survive DB re-indexes and cross-device imports.
  const [trackAbPoints, setTrackAbPoints] = useState<Record<string, { a: number; b: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.ab_points') ?? '{}'); } catch { return {}; }
  });
  const [folderPopupItem, setFolderPopupItem] = useState<Playlist | null>(null);
  const [folders, setFolders] = useState<{ id: number; name: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.folders') ?? '[]'); } catch { return []; }
  });
  const [folderAssignments, setFolderAssignments] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('melomaniac.folder_assignments') ?? '{}'); } catch { return {}; }
  });
  const [editorTrackId, setEditorTrackId] = useState<number | null>(null);
  const [activeTrackId, setActiveTrackId] = useState(1);
  // User-local favorites — persisted to localStorage, never committed to git
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('melomaniac.favorites') ?? '[]')); } catch { return new Set(); }
  });
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<Track[] | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const lastSeekTime = useRef(0);
  // Live position updated on every PositionChanged without triggering a re-render.
  // PlayerControls / MiniPlayer read this via rAF and update their DOM directly.
  const livePositionMsRef = useRef(0);
  // Tracks whether we've already recorded a play for the current loaded track.
  // Reset whenever a new track is loaded so each track gets at most one play record.
  const hasRecordedPlayRef = useRef(false);
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const [volume, setVolume] = useState(0.30);
  const [miniPlayerCollapsed, setMiniPlayerCollapsed] = useState(false);
  const [bigPicture, setBigPicture] = useState(false);
  const [carouselBigPicture, setCarouselBigPicture] = useState(false);
  // trackListSlide: drives translateY (visual slide, has CSS transition)
  // trackListSpace: drives max-height (layout space, instant — no transition)
  // Decoupled so close = slide then collapse, open = expand then slide up simultaneously
  const [trackListSlide, setTrackListSlide] = useState(true);
  const [trackListSpace, setTrackListSpace] = useState(true);
  const bigPictureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [manualQueue, setManualQueue] = useState<Track[]>([]);
  const [sessionExcluded, setSessionExcluded] = useState<Set<string>>(new Set());
  const [showQueue, setShowQueue] = useState(false);
  const [vibeText, setVibeText] = useState('chill ambient music for focus');
  const [meloToast, setMeloToast] = useState<string | null>(null);
  const [commitRefreshKey, setCommitRefreshKey] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [appStats, setAppStats] = useState<{ memory_mb: number; cpu_usage: number } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  const activePlaylist = playlistRecords.find(p => p.id === activePlaylistId) ?? null;
  // Override description with the branch-specific value from the tree blob.
  // playlistRecords carries the SQL-cached description (last-write-wins across branches),
  // while branchMeta comes from load_tree for the active branch specifically.
  const playlistForHeader = activePlaylist && branchMeta
    ? { ...activePlaylist, description: branchMeta.description }
    : activePlaylist;

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
  const activeArtworkUrl = artworkUrls[playQueue[carouselIdx]?.hash ?? ''] ?? null;
  const artworkAccents = useAccentsFromUrl(activeArtworkUrl);
  const { slots: glowSlots, activeSlot: glowActive } = useGlowFade(artworkAccents);

  // Stale-closure ref — updated synchronously each render so the audio event
  // listener (which is registered once) always reads the latest values.
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
  const skipNextRef  = useRef<() => void>(() => {});
  const skipPrevRef  = useRef<() => void>(() => {});
  const abCommitRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  type SavedPlaybackState = {
    hash: string; durationMs: number;
    playlistId: string | null; branchName: string | null;
    isShuffle: boolean; shuffleMode: ShuffleMode;
    shuffledHashes?: string[];
    loopMode?: LoopMode;
    positionMs?: number;
    coldStart?: boolean;
  };
  const pendingRestoreRef = useRef<SavedPlaybackState | null>(null);

  // ── Theme effect — all palette logic lives in shared/themes.ts ──────────
  useEffect(() => {
    applyTheme(settings.theme, settings.accentHue);
  }, [settings.theme, settings.accentHue]);

  // Sequential big-picture animations to avoid the carousel bouncing mid-layout.
  // ENTER: collapse tracklist first (380ms), then expand pane + carousel.
  // EXIT:  shrink pane + carousel first (380ms), then reveal tracklist.
  const enterBigPicture = useCallback(() => {
    if (bigPictureTimerRef.current) clearTimeout(bigPictureTimerRef.current);
    setBigPicture(true);
    setTrackListSlide(false);  // Phase 1: slide down (visual, 380ms)
    bigPictureTimerRef.current = setTimeout(() => {
      setTrackListSpace(false);  // Phase 2a: collapse space instantly (content already off-screen)
      // Phase 2b: one rAF so the browser computes the freed space before the
      // flex-grow transition starts — prevents the carousel jump on enter.
      requestAnimationFrame(() => setCarouselBigPicture(true));
      bigPictureTimerRef.current = null;
    }, 380);
  }, []);

  const exitBigPicture = useCallback(() => {
    if (bigPictureTimerRef.current) clearTimeout(bigPictureTimerRef.current);
    setBigPicture(false);
    setCarouselBigPicture(false);
    bigPictureTimerRef.current = setTimeout(() => {
      // Both in same React batch: space appears instantly, slide-up begins simultaneously
      setTrackListSpace(true);
      setTrackListSlide(true);
      bigPictureTimerRef.current = null;
    }, 380);
  }, []);

  // Keep top pane tall enough whenever carousel size changes
  useEffect(() => {
    setTopPaneHeight(h => Math.max(h, settings.carouselSize + 190));
  }, [settings.carouselSize]);

  // Sync initial volume to the audio backend on mount
  useEffect(() => {
    invoke('audio_set_volume', { volume }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount, check whether audio is still playing from a previous session (e.g. after a
  // WebView2 restart on Windows). If audio_position resolves, the bridge still has a track
  // loaded — mark the saved state for restoration once the library/playlist data arrives.
  useEffect(() => {
    const raw = localStorage.getItem('melomaniac.playback_state');
    if (!raw) return;
    let saved: SavedPlaybackState;
    try { saved = JSON.parse(raw); } catch { return; }
    invoke<number>('audio_position')
      .then(() => { pendingRestoreRef.current = saved; })
      .catch(() => {
        // Cold start — audio engine is not running, but we still restore the track
        // as a paused restore (load without play, seek to saved position).
        pendingRestoreRef.current = { ...saved, coldStart: true };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background peer poll — drives auto-sync when a known device comes online.
  // Populate the Zustand playlists store first so triggerAutoSync has local
  // state to compare against before the first poll fires.
  useEffect(() => {
    loadPlaylists().then(() => refreshLivePeers())
    refreshKnownDevices()
    const id = setInterval(refreshLivePeers, 15_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the commit graph whenever a background sync imports new commits.
  useEffect(() => {
    if (syncVersion > 0) setCommitRefreshKey(k => k + 1)
  }, [syncVersion]);

  // Push commit author to the backend on mount and whenever the setting changes.
  // We do NOT read back from get_commit_author: Rust initialises from $USER (not
  // persisted to disk), so fetching it on startup would overwrite the user's
  // localStorage value with their OS username.
  useEffect(() => {
    invoke('set_commit_author', { name: settings.commitAuthor }).catch(console.error);
  }, [settings.commitAuthor]);


  // ── Load real tracks from storage on mount ───────────────────────────────
  const reloadLibrary = useCallback(() => {
    invoke<TrackRecord[]>('library_get_all')
      .then(records => { if (records.length > 0) setTrackOrder(records.map(trackRecordToTrack)); })
      .catch(console.error);
  }, []);

  useEffect(() => { reloadLibrary(); }, []);

  // Restore playback state if audio is still playing and the track came from the library
  // (no playlist context). Playlist-context restore happens in the playlistTracks effect.
  useEffect(() => {
    const r = pendingRestoreRef.current;
    if (!r || r.playlistId !== null || trackOrder.length === 0) return;
    const track = trackOrder.find(t => t.hash === r.hash);
    if (!track) { pendingRestoreRef.current = null; return; }
    useStore.getState().setLoaded(r.hash, r.durationMs);
    setActiveTrackId(track.id);
    sr.current.durationMs = r.durationMs;
    if (r.loopMode) { setLoopMode(r.loopMode); sr.current.loopMode = r.loopMode; }
    hasRecordedPlayRef.current = true;
    if (r.coldStart) {
      invoke('track_load_paused', { hash: r.hash })
        .then(() => {
          if (r.positionMs && r.positionMs > 0) {
            livePositionMsRef.current = r.positionMs;
            setPositionMs(r.positionMs);
            invoke('audio_seek', { positionMs: r.positionMs }).catch(console.error);
          }
        })
        .catch(console.error);
      useStore.getState().setPlaying(false);
    } else {
      useStore.getState().setPlaying(true);
    }
    if (r.isShuffle) {
      setIsShuffle(true);
      if (r.shuffledHashes?.length) {
        const validSet = new Set(trackOrder.map(t => t.hash));
        const restored = r.shuffledHashes
          .filter(h => validSet.has(h))
          .map(h => trackOrder.find(t => t.hash === h)!);
        setShuffledQueue(restored.length > 0 ? restored : buildShuffledQueue(trackOrder, r.shuffleMode));
      } else {
        setShuffledQueue(buildShuffledQueue(trackOrder, r.shuffleMode));
      }
    }
    pendingRestoreRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackOrder]);

  // ── Refresh library when a download completes ────────────────────────────
  useEffect(() => {
    const unsub = listen('download://done', () => reloadLibrary());
    return () => { unsub.then(fn => fn()); };
  }, [reloadLibrary]);

  // ── Load real playlists from backend ─────────────────────────────────────
  const reloadPlaylists = useCallback(() => {
    invoke<PlaylistRecord[]>('playlist_get_all')
      .then(records => {
        setPlaylistRecords(records);
        setActivePlaylistId(prev => {
          if (prev !== null) return prev;
          const saved = localStorage.getItem('mm_last_desktop_playlist');
          if (saved && records.some(r => r.id === saved)) return saved;
          return records[0]?.id ?? null;
        });
      })
      .catch(console.error);
  }, []);

  useEffect(() => { reloadPlaylists(); }, []);

  // Persist active playlist so it survives restarts
  useEffect(() => {
    if (activePlaylistId) localStorage.setItem('mm_last_desktop_playlist', activePlaylistId);
  }, [activePlaylistId]);

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

    if (!activePlaylistId) { setPlaylistTracks(null); setBranchMeta(null); return; }
    invoke<TrackRecord[]>('playlist_get_tracks', {
      playlistId: activePlaylistId,
      branchName: activeBranch,
    })
      .then(records => {
        const newTracks = records.map(trackRecordToTrack);
        setPlaylistTracks(newTracks);
        // Seed A/B points from the committed tree (backend is authoritative per playlist)
        const committed: Record<string, { a: number; b: number }> = {};
        for (const r of records) {
          if (r.ab_start_ms != null && r.ab_end_ms != null && r.duration_ms > 0) {
            committed[r.hash] = {
              a: r.ab_start_ms / r.duration_ms,
              b: r.ab_end_ms   / r.duration_ms,
            };
          }
        }
        if (Object.keys(committed).length > 0) {
          setTrackAbPoints(prev => ({ ...prev, ...committed }));
        }
        // Branch switch within same playlist — rebuild shuffled queue from new tracks
        if (!playlistChanged && newTracks.length > 0) {
          setShuffledQueue(q => q ? buildShuffledQueue(newTracks, sr.current.shuffleMode) : null);
        }
      })
      .catch(() => setPlaylistTracks([]));

    invoke<{ description: string | null }>('playlist_get_meta', {
      playlistId: activePlaylistId,
      branchName: activeBranch,
    })
      .then(meta => setBranchMeta({ description: meta.description }))
      .catch(() => setBranchMeta(null));
  }, [activePlaylistId, activeBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear session-excluded hashes whenever the active playlist or branch changes.
  useEffect(() => { setSessionExcluded(new Set()); }, [activePlaylistId, activeBranch]);

  // Restore playback state if audio is still playing and the track came from a playlist.
  // Runs after playlistTracks loads; the playlist change effect may have reset isShuffle
  // to false, but we override it here since we're restoring a prior session.
  useEffect(() => {
    const r = pendingRestoreRef.current;
    if (!r || r.playlistId === null || !playlistTracks) return;
    if (activePlaylistId !== r.playlistId || activeBranch !== r.branchName) return;
    const track = playlistTracks.find(t => t.hash === r.hash);
    if (!track) { pendingRestoreRef.current = null; return; }
    useStore.getState().setLoaded(r.hash, r.durationMs);
    setActiveTrackId(track.id);
    sr.current.durationMs = r.durationMs;
    if (r.loopMode) { setLoopMode(r.loopMode); sr.current.loopMode = r.loopMode; }
    hasRecordedPlayRef.current = true;
    if (r.coldStart) {
      invoke('track_load_paused', { hash: r.hash })
        .then(() => {
          if (r.positionMs && r.positionMs > 0) {
            livePositionMsRef.current = r.positionMs;
            setPositionMs(r.positionMs);
            invoke('audio_seek', { positionMs: r.positionMs }).catch(console.error);
          }
        })
        .catch(console.error);
      useStore.getState().setPlaying(false);
    } else {
      useStore.getState().setPlaying(true);
    }
    if (r.isShuffle) {
      setIsShuffle(true);
      if (r.shuffledHashes?.length) {
        const validSet = new Set(playlistTracks.map(t => t.hash));
        const restored = r.shuffledHashes
          .filter(h => validSet.has(h))
          .map(h => playlistTracks.find(t => t.hash === h)!);
        setShuffledQueue(restored.length > 0 ? restored : buildShuffledQueue(playlistTracks, r.shuffleMode));
      } else {
        setShuffledQueue(buildShuffledQueue(playlistTracks, r.shuffleMode));
      }
    }
    pendingRestoreRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistTracks]);

  // ── Discord Rich Presence ─────────────────────────────────────────────────
  // Connect/disconnect the client first, then set the current activity so the
  // now-playing status is live immediately on startup and on every track change.
  // Chaining ensures discord_set_activity never races against an unfinished connect.
  // The stale flag guards against out-of-order resolution when tracks change rapidly:
  // React runs the cleanup function before the next effect fires, so by the time a
  // superseded promise chain resolves, stale=true and the set_activity call is skipped.
  useEffect(() => {
    let stale = false;
    invoke('discord_apply_settings', { enabled: settings.discordEnabled })
      .then(() => {
        if (stale || !settings.discordEnabled) return;
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
      })
      .catch(console.error);
    return () => { stale = true; };
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
            setMeloToast('Dev reset: all playlists cleared');
            setTimeout(() => setMeloToast(null), 2400);
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

  // ── Update check — runs once on startup, skipped in dev builds ──────────
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const timer = setTimeout(() => {
      checkForUpdate()
        .then(update => { if (update?.available) setPendingUpdate(update); })
        .catch(() => {});
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

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
      useStore.getState().setLoaded(track.hash, track.duration_ms);
      sr.current.durationMs = track.duration_ms;
      setPositionMs(0);
      livePositionMsRef.current = 0;
      hasRecordedPlayRef.current = false;
      useStore.getState().setPlaying(true);
      invoke('track_play', { hash: track.hash }).catch(console.error);
    };

    let unlisten: (() => void) | undefined;
    listen<AudioPayload>('audio://event', ({ payload }) => {
      if (typeof payload === 'object' && 'PositionChanged' in payload) {
        const posMs = payload.PositionChanged;
        // ── A·B loop enforcement — runs regardless of seek throttle ──────────
        const { loopMode: lm, abA: a, abB: b, durationMs: dur } = sr.current;
        if (lm === 'ab' && dur > 0 && posMs >= b * dur) {
          const aMs = Math.round(a * dur);
          // Stamp lastSeekTime so the 600 ms debounce below doesn't overwrite livePositionMsRef.
          lastSeekTime.current = Date.now();
          livePositionMsRef.current = aMs;
          sr.current.positionMs = aMs;
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          return; // skip visual update below — we already set livePositionMsRef
        }
        // 600 ms guard: skip live position updates immediately after a seek to
        // avoid the seek bar snapping backward before the backend catches up.
        if (Date.now() - lastSeekTime.current > 600) {
          livePositionMsRef.current = posMs;
          sr.current.positionMs = posMs;
        }
        // Record a play once the listener crosses 50% of the track or 4 minutes,
        // whichever comes first. This matches the Last.fm / Spotify convention and
        // captures skips-near-the-end that TrackEnded would miss.
        if (!hasRecordedPlayRef.current) {
          const dur = sr.current.durationMs;
          const lh  = sr.current.loadedHash;
          if (lh && dur > 0 && posMs >= Math.min(dur * 0.5, 240_000)) {
            hasRecordedPlayRef.current = true;
            invoke('track_record_play', { hash: lh, durationMs: posMs }).catch(console.error);
          }
        }
      }
      if (typeof payload === 'object' && 'DurationKnown' in payload) {
        if (payload.DurationKnown > 0) {
          const lh = useStore.getState().loadedTrackHash;
          if (lh) useStore.getState().setLoaded(lh, payload.DurationKnown);
          sr.current.durationMs = payload.DurationKnown;
        }
      }
      if (payload === 'TrackEnded') {
        setPositionMs(0);
        const { loopMode: lm, loadedHash: lh, abA: a, durationMs: dur } = sr.current;

        if (lm === 'one') {
          if (lh) invoke('track_play', { hash: lh }).catch(console.error);
          hasRecordedPlayRef.current = false; // reset so each loop iteration counts
          useStore.getState().setPlaying(true);
          return;
        }
        if (lm === 'ab') {
          const aMs = Math.floor(a * dur);
          lastSeekTime.current = Date.now();
          setPositionMs(aMs);
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          useStore.getState().resumeAudio().catch(console.error);
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
            // Avoid immediately repeating the just-finished track at position 0.
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
      if (payload === 'RemotePlay')             useStore.getState().resumeAudio().catch(console.error);
      if (payload === 'RemotePause')            useStore.getState().pauseAudio().catch(console.error);
      if (payload === 'RemoteTogglePlayPause')  useStore.getState().toggleAudio().catch(console.error);
      if (payload === 'RemoteNextTrack')     skipNextRef.current();
      if (payload === 'RemotePreviousTrack') skipPrevRef.current();
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Artwork prefetch — loads a window around the current carousel position ──
  // Tracks which hashes have been fetched/in-flight so we never duplicate requests.
  const fetchedHashesRef = useRef(new Set<string>());
  useEffect(() => {
    // When artworkVersion bumps (sync downloaded new artwork), clear the guard
    // so all tracks get re-fetched with fresh data URLs.
    if (artworkVersion > 0) fetchedHashesRef.current.clear();
    for (const track of playQueue) {
      if (!track?.artwork_hash) continue;
      if (fetchedHashesRef.current.has(track.hash)) continue;
      fetchedHashesRef.current.add(track.hash);
      invoke<string>('track_get_artwork', { hash: track.hash })
        .then(dataUrl => {
          setArtworkUrls(prev => ({ ...prev, [track.hash]: dataUrl }));
        })
        .catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playQueue, artworkVersion]);

  // ── Load artwork for the active playlist branch ───────────────────────────
  useEffect(() => {
    if (!activePlaylist) return;
    const key = `pl_${activePlaylist.id}::${activeBranch}`;
    if (artworkUrls[key]) return;
    invoke<string>('playlist_get_artwork', { playlistId: activePlaylist.id, branchName: activeBranch })
      .then(dataUrl => {
        setArtworkUrls(prev => ({ ...prev, [key]: dataUrl }));
      })
      .catch(() => {
        setArtworkUrls(prev => ({ ...prev, [key]: '' }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylist?.id, activeBranch]);

  // ── Persist playback state for restart recovery ──────────────────────────
  useEffect(() => {
    return useStore.subscribe(state => {
      if (state.loadedTrackHash) {
        localStorage.setItem('melomaniac.playback_state', JSON.stringify({
          hash: state.loadedTrackHash, durationMs: state.duration_ms,
          playlistId: activePlaylistId, branchName: activeBranch,
          isShuffle, shuffleMode: settings.shuffleMode,
          shuffledHashes: isShuffle && shuffledQueue ? shuffledQueue.map(t => t.hash) : undefined,
          loopMode,
        } satisfies SavedPlaybackState));
      } else {
        localStorage.removeItem('melomaniac.playback_state');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylistId, activeBranch, isShuffle, settings.shuffleMode, shuffledQueue, loopMode]);

  // Persist playback position periodically and on unload so cold-start restore
  // can seek back to where the user left off (mirrors Spotify's behaviour).
  useEffect(() => {
    const patchPosition = () => {
      const raw = localStorage.getItem('melomaniac.playback_state');
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        s.positionMs = livePositionMsRef.current;
        localStorage.setItem('melomaniac.playback_state', JSON.stringify(s));
      } catch { /* ignore */ }
    };
    const id = setInterval(patchPosition, 10_000);
    window.addEventListener('beforeunload', patchPosition);
    return () => { clearInterval(id); window.removeEventListener('beforeunload', patchPosition); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist sidebar state to localStorage ────────────────────────────────
  useEffect(() => {
    localStorage.setItem('melomaniac.pinned', JSON.stringify([...pinnedIds]));
  }, [pinnedIds]);

  useEffect(() => {
    localStorage.setItem('melomaniac.folders', JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem('melomaniac.folder_assignments', JSON.stringify(folderAssignments));
  }, [folderAssignments]);

  useEffect(() => {
    localStorage.setItem('melomaniac.ab_points', JSON.stringify(trackAbPoints));
  }, [trackAbPoints]);

  useEffect(() => {
    localStorage.setItem('melomaniac.favorites', JSON.stringify([...favorites]));
  }, [favorites]);

  // ── Sync A·B handles on track change OR when committed points load ────────
  // Also writes sr.current immediately so the PositionChanged handler doesn't
  // wait for the next render to see the correct A/B values.
  useEffect(() => {
    const hash = playQueue.find(t => t.id === activeTrackId)?.hash
               ?? trackOrder.find(t => t.id === activeTrackId)?.hash;
    const pts = hash ? trackAbPoints[hash] : undefined;
    if (pts) {
      setAbA(pts.a); setAbB(pts.b);
      sr.current.abA = pts.a; sr.current.abB = pts.b;
    } else {
      setAbA(0); setAbB(1);
      sr.current.abA = 0; sr.current.abB = 1;
    }
  }, [activeTrackId, trackAbPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const togglePin = (id: string) => setPinnedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const removeFromFolder = (playlistId: string) => {
    setFolderAssignments(prev => {
      const next = { ...prev };
      delete next[playlistId];
      return next;
    });
  };

  const deleteFolder = (folderId: number) => {
    setFolders(f => f.filter(folder => folder.id !== folderId));
    setFolderAssignments(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === folderId) delete next[key];
      }
      return next;
    });
  };

  const handleReorder = (newOrder: Track[] | null) => {
    if (newOrder === null) {
      invoke<TrackRecord[]>('library_get_all')
        .then(records => setTrackOrder(records.map(trackRecordToTrack)))
        .catch(() => setTrackOrder([]));
      setHasUncommitted(false);
    } else {
      setTrackOrder(newOrder);
      setHasUncommitted(true);
    }
    if (shuffledQueue) { setShuffledQueue(null); setIsShuffle(false); }
  };

  const toast = (msg: string, ms = 1800) => {
    setMeloToast(msg);
    setTimeout(() => setMeloToast(null), ms);
  };

  // off → fisher-yates → balanced → random → off
  const handleShuffle = () => {
    if (!isShuffle) {
      updateSetting('shuffleMode', 'fisher-yates');
      const newQ = buildShuffledQueue(activeQueue, 'fisher-yates');
      sr.current.playQueue = newQ; // sync update so TrackEnded sees it before next render
      sr.current.isShuffle = true;
      setShuffledQueue(newQ);
      setIsShuffle(true);
      toast('Shuffle: True Shuffle');
    } else if (settings.shuffleMode === 'fisher-yates') {
      updateSetting('shuffleMode', 'smart');
      const newQ = buildShuffledQueue(activeQueue, 'smart');
      sr.current.playQueue = newQ;
      setShuffledQueue(newQ);
      toast('Shuffle: Smart');
    } else {
      sr.current.playQueue = activeQueue;
      sr.current.isShuffle = false;
      setShuffledQueue(null);
      setIsShuffle(false);
      toast('Shuffle: Off');
    }
  };

  const handleCommitReorder = () => {
    handleMeloAction('commit');
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
      setMeloToast(`Removed "${title}"`);
      setTimeout(() => setMeloToast(null), 2400);
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
      setMeloToast(`Deleted "${name}"`);
      setTimeout(() => setMeloToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, playlistRecords]);

  const handleRenamePlaylist = useCallback(async (newName: string) => {
    if (!activePlaylistId) return;
    try {
      await invoke('playlist_rename', { playlistId: activePlaylistId, branchName: activeBranch, newName, message: '' });
      reloadPlaylists();
      setCommitRefreshKey(k => k + 1);
      setMeloToast(`Renamed to "${newName}"`);
      setTimeout(() => setMeloToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, activeBranch, reloadPlaylists]);

  const handleSetDescription = useCallback(async (desc: string | null) => {
    if (!activePlaylistId) return;
    try {
      await invoke('playlist_set_description', { playlistId: activePlaylistId, branchName: activeBranch, description: desc });
      setBranchMeta({ description: desc });
      reloadPlaylists();
      setCommitRefreshKey(k => k + 1);
      setMeloToast(desc ? 'Description updated' : 'Description cleared');
      setTimeout(() => setMeloToast(null), 2400);
    } catch (e) { console.error(e); }
  }, [activePlaylistId, activeBranch, reloadPlaylists]);

  const handleAbChange = (handle: 'A' | 'B', val: number) => {
    const hash = playQueue.find(t => t.id === activeTrackId)?.hash
               ?? trackOrder.find(t => t.id === activeTrackId)?.hash;
    if (!hash) return;
    if (handle === 'A') {
      setAbA(val); sr.current.abA = val;
      setTrackAbPoints(p => ({ ...p, [hash]: { ...(p[hash] ?? { a: 0, b: 1 }), a: val } }));
    } else {
      setAbB(val); sr.current.abB = val;
      setTrackAbPoints(p => ({ ...p, [hash]: { ...(p[hash] ?? { a: 0, b: 1 }), b: val } }));
    }

    // Debounced commit — only when a playlist is active; uses sr.current so the
    // timeout always sees the final values after rapid dragging.
    if (activePlaylistId) {
      if (abCommitRef.current) clearTimeout(abCommitRef.current);
      const playlistId = activePlaylistId;
      const branchName = activeBranch;
      // Capture hadPoints at drag-start: returning to full-range sends null to clear
      // the tree entry only when points were previously committed.
      const hadPoints = hash in trackAbPoints;
      abCommitRef.current = setTimeout(() => {
        const a = sr.current.abA;
        const b = sr.current.abB;
        const dur = sr.current.durationMs;
        if (dur <= 0) return;
        const isFullRange = a < 0.001 && b > 0.999;
        if (isFullRange && !hadPoints) return; // never committed, nothing to clear
        invoke('playlist_set_ab_loop', {
          playlistId,
          branchName,
          trackHash: hash,
          abStartMs: isFullRange ? null : Math.round(a * dur),
          abEndMs:   isFullRange ? null : Math.round(b * dur),
        }).then(() => {
          setCommitRefreshKey(k => k + 1);
          if (isFullRange) {
            setTrackAbPoints(p => { const next = { ...p }; delete next[hash]; return next; });
            setMeloToast('A/B loop cleared');
          } else {
            setMeloToast('A/B loop saved');
          }
          setTimeout(() => setMeloToast(null), 2400);
        }).catch(console.error);
      }, 1500);
    }
  };

  const handleLoopCycle = () => setLoopMode(m => {
    const next = m === 'off' ? 'one' : m === 'one' ? 'ab' : 'off';
    sr.current.loopMode = next; // sync update so TrackEnded sees it before next render
    return next;
  });

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

  const handleMeloAction = (action: string) => {
    const msgs: Record<string, string> = {
      commit: 'Committed snapshot → a3f891',
      push: 'Pushed to upstream/study-beats ✓',
      pull: 'Pulled 2 new tracks from remote',
      shuffle: 'Shuffled queue',
      branch: 'Branch created',
    };
    setMeloToast(msgs[action] ?? action);
    setTimeout(() => setMeloToast(null), 2400);
  };

  const handleRailChange = (item: string) => {
    setRailItem(item);
    if (item === 'melo') setShowCommitGraph(true);
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
      useStore.getState().toggleAudio().catch(console.error);
    } else {
      // Different track — load and play it
      setActiveTrackId(id);
      invoke('track_play', { hash: track.hash }).catch(console.error);
      useStore.getState().setLoaded(track.hash, track.duration_ms);
      sr.current.durationMs = track.duration_ms;
      useStore.getState().setPlaying(true);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
    }
  };

  const handleSkipNext = () => {
    if (loadedHash)
      invoke('track_record_skip', { hash: loadedHash, positionMs: livePositionMsRef.current }).catch(console.error);
    setLoopMode('off'); sr.current.loopMode = 'off';
    // Manual queue takes priority
    if (manualQueue.length > 0) {
      const [next, ...rest] = manualQueue;
      setManualQueue(rest);
      setActiveTrackId(next.id);
      invoke('track_play', { hash: next.hash }).catch(console.error);
      useStore.getState().setLoaded(next.hash, next.duration_ms);
      sr.current.durationMs = next.duration_ms;
      useStore.getState().setPlaying(true);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
      return;
    }
    const q = playQueue.filter(t => !sessionExcluded.has(t.hash));
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const nextIdx = (idx + 1) % q.length;
    const next = q[nextIdx];
    setActiveTrackId(next.id);
    invoke('track_play', { hash: next.hash }).catch(console.error);
    useStore.getState().setLoaded(next.hash, next.duration_ms);
    sr.current.durationMs = next.duration_ms;
    useStore.getState().setPlaying(true);
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
  };
  skipNextRef.current = handleSkipNext;

  const handleSkipPrev = () => {
    // Restart current track if more than 3 s in — reload is more reliable than seek-to-0
    if (livePositionMsRef.current > 3000 && loadedHash) {
      invoke('track_play', { hash: loadedHash }).catch(console.error);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
      useStore.getState().setPlaying(true);
      return;
    }
    if (loadedHash)
      invoke('track_record_skip', { hash: loadedHash, positionMs: livePositionMsRef.current }).catch(console.error);
    setLoopMode('off'); sr.current.loopMode = 'off';
    const q = playQueue;
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const prevIdx = (idx - 1 + q.length) % q.length;
    const prev = q[prevIdx];
    setActiveTrackId(prev.id);
    invoke('track_play', { hash: prev.hash }).catch(console.error);
    useStore.getState().setLoaded(prev.hash, prev.duration_ms);
    sr.current.durationMs = prev.duration_ms;
    useStore.getState().setPlaying(true);
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
  };
  skipPrevRef.current = handleSkipPrev;

  const handlePlayPause = () => {
    // If audio is already loaded, toggle it — even if the current track isn't
    // in the active queue (e.g. switched to a branch that doesn't have it).
    if (loadedHash) {
      const queueTrack = playQueue.find(t => t.id === activeTrackId);
      if (!queueTrack || queueTrack.hash === loadedHash) {
        useStore.getState().toggleAudio().catch(console.error);
        return;
      }
      // A different track is selected in the queue — load it
      invoke('track_play', { hash: queueTrack.hash }).catch(console.error);
      useStore.getState().setLoaded(queueTrack.hash, queueTrack.duration_ms);
      sr.current.durationMs = queueTrack.duration_ms;
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
      useStore.getState().setPlaying(true);
      return;
    }
    // Nothing loaded yet — load the selected track from the queue
    const track = playQueue.find(t => t.id === activeTrackId);
    if (!track?.hash) return;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    useStore.getState().setLoaded(track.hash, track.duration_ms);
    sr.current.durationMs = track.duration_ms;
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
    useStore.getState().setPlaying(true);
  };

  return (
    <div className="desktop-root">
      <WindowResizeEdges />
      <div className="app-window">
        <TitleBar />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Sidebar */}
          <LibrarySidebar
            playlists={playlistRecords.map(playlistRecordToPlaylist)}
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={id => { setActivePlaylistId(id); setActiveTab('Tracks'); setRailItem('playlists'); }}
            activeRailItem={railItem}
            onRailChange={handleRailChange}
            expanded={leftExpanded}
            onToggleExpanded={() => setLeftExpanded(p => !p)}
            panelWidth={sidebarWidth}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            folders={folders}
            folderAssignments={folderAssignments}
            onRemoveFromFolder={removeFromFolder}
            onAssignToFolder={(playlistId, folderId) => {
              if (folderId == null) removeFromFolder(playlistId);
              else setFolderAssignments(prev => ({ ...prev, [playlistId]: folderId }));
            }}
            onDeleteFolder={deleteFolder}
            onOpenSettings={() => setShowSettings(true)}
            onAddToFolderClick={setFolderPopupItem}
            onNewPlaylist={() => setShowNewPlaylist(true)}
          />
          {leftExpanded && (
            <ResizeHandle direction="h" onDelta={d => setSidebarWidth(w => Math.max(140, Math.min(400, w + d)))} />
          )}

          {/* Center column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>
            {railItem === 'history' ? (
              <StatsView />
            ) : railItem === 'library' ? (
              <LibraryView
                artworkUrls={artworkUrls}
                onOpenInEditor={hash => { setEditorTrackId(trackOrder.find(t => t.hash === hash)?.id ?? null); setRailItem('editor'); }}
                onTracksChanged={setTrackOrder}
                defaultPlaylistId={activePlaylistId}
                defaultBranchName={activeBranch}
                onTracksAddedToPlaylist={(playlistId, branchName, count) => {
                  const plName = playlistRecords.find(p => p.id === playlistId)?.name ?? 'playlist';
                  setMeloToast(`Added ${count} ${count === 1 ? 'track' : 'tracks'} to "${plName}"`);
                  setTimeout(() => setMeloToast(null), 2400);
                  if (playlistId === activePlaylistId && branchName === activeBranch) {
                    invoke<TrackRecord[]>('playlist_get_tracks', { playlistId, branchName })
                      .then(r => setPlaylistTracks(r.map(trackRecordToTrack)))
                      .catch(console.error);
                  }
                  setCommitRefreshKey(k => k + 1);
                }}
                favorites={favorites}
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
                  if (loadedHash === oldHash) useStore.getState().setLoaded(newHash, durationMs);
                  setMeloToast('Metadata saved · committed to all branches');
                  setTimeout(() => setMeloToast(null), 3000);
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
                  setMeloToast(msg);
                  setTimeout(() => setMeloToast(null), 3000);
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
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  isPinned={activePlaylistId ? pinnedIds.has(activePlaylistId) : false}
                  onTogglePin={() => { if (activePlaylistId) togglePin(activePlaylistId); }}
                  onNewBranch={() => setShowBranchModal(true)}
                  onMerge={() => setShowMergeModal(true)}
                  onFork={() => setShowForkModal(true)}
                  onEditArtwork={() => setShowArtworkModal(true)}
                  onBranchesChanged={reloadPlaylists}
                  hasConflict={activePlaylistId ? pendingConflictPlaylists.includes(activePlaylistId) : false}
                  onResolveConflict={() => { if (activePlaylistId) reopenConflict(activePlaylistId); }}
                />

                {activeTab === 'Tracks' && (
                  <>
                    <div style={{
                      position: 'relative',
                      height: topPaneHeight,
                      flexGrow: carouselBigPicture ? 1 : 0,
                      flexShrink: 0,
                      minHeight: 0,
                      overflow: 'hidden', display: 'flex', flexDirection: 'column',
                      background: 'var(--bg-2)',
                      paddingBottom: carouselBigPicture ? 28 : 0,
                      transition: 'flex-grow 0.38s cubic-bezier(0.4,0,0.2,1), padding-bottom 0.38s ease',
                    }}>
                      {/* Artwork bloom — two slots cross-fade so gradient changes animate smoothly
                           (CSS can't interpolate between gradient values, opacity cross-fade instead) */}
                      {glowSlots.map((slot, i) => slot[0] && (
                        <div key={i} style={{
                          position: 'absolute', left: '50%', top: carouselBigPicture ? '45%' : '38%',
                          transform: 'translate(-50%, -50%)',
                          width: '75%', height: carouselBigPicture ? '70%' : '160%',
                          borderRadius: '50%',
                          background: `radial-gradient(ellipse at center, ${withAlpha(slot[0], 0.35)} 0%, ${withAlpha(slot[1], 0.16)} 45%, transparent 70%)`,
                          filter: 'blur(30px)',
                          pointerEvents: 'none',
                          zIndex: 0,
                          opacity: glowActive === i ? 1 : 0,
                          transition: 'opacity 0.9s ease',
                        }} />
                      ))}
                      <div style={{ paddingTop: 14, paddingBottom: 4, flexShrink: carouselBigPicture ? undefined : 0, flex: carouselBigPicture ? 1 : undefined, minHeight: carouselBigPicture ? 0 : undefined, position: 'relative', zIndex: 1 }}>
                        <Carousel
                          albums={carouselAlbums}
                          activeIndex={carouselIdx}
                          onIndexChange={idx => {
                            const t = playQueue[idx];
                            if (t) handleSelectTrack(t.id);
                          }}
                          size={settings.carouselSize}
                          activeGlowColors={artworkAccents}
                          bigPicture={carouselBigPicture}
                        />
                      </div>
                      <div style={{ position: 'relative', zIndex: 1 }}>
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
                          bigPicture={bigPicture} onBigPicture={() => bigPicture ? exitBigPicture() : enterBigPicture()}
                          onSeek={pct => {
                            const ms = Math.floor(pct * durationMs);
                            lastSeekTime.current = Date.now();
                            setPositionMs(ms); livePositionMsRef.current = ms;
                            invoke('audio_seek', { positionMs: ms }).catch(console.error);
                          }}
                          volume={volume} onVolume={v => { setVolume(v); invoke('audio_set_volume', { volume: v }).catch(console.error); }}
                          abA={abA} abB={abB} onAbChange={handleAbChange}
                          artworkAccents={artworkAccents}
                        />
                      </div>
                    </div>
                    <div style={{
                      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden',
                      maxHeight: trackListSpace ? 2000 : 0,
                      // No transition — space collapses/expands instantly so only the slide is visible
                      pointerEvents: trackListSlide ? undefined : 'none',
                    }}>
                      <div style={{
                        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
                        transform: trackListSlide ? 'translateY(0)' : 'translateY(100%)',
                        transition: 'transform 0.38s cubic-bezier(0.4,0,0.2,1)',
                      }}>
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
                          setMeloToast('Select tracks in the library, then use "Add to Playlist"');
                          setTimeout(() => setMeloToast(null), 3000);
                        } : undefined}
                        onPlayNext={track => { setManualQueue(q => [track, ...q]); toast(`"${track.title}" plays next`); }}
                        onAddToQueue={track => { setManualQueue(q => [...q, track]); toast(`"${track.title}" added to queue`); }}
                        favorites={favorites}
                        density={settings.density}
                        onCollapse={enterBigPicture}
                      />
                      </div>
                    </div>
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
                    onSetDescription={handleSetDescription}
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
            playQueue={playQueue.filter(t => !sessionExcluded.has(t.hash))}
            manualQueue={manualQueue}
            loadedHash={loadedHash}
            artworkUrls={artworkUrls}
            onRemoveManual={idx => setManualQueue(q => q.filter((_, i) => i !== idx))}
            onClearManual={() => setManualQueue([])}
            onRemoveUpcoming={hash => setSessionExcluded(s => new Set([...s, hash]))}
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
            abA={abA}
            abB={abB}
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
            artworkAccents={artworkAccents}
            showQueue={showQueue} onQueueToggle={() => setShowQueue(p => !p)}
            onCollapse={() => setMiniPlayerCollapsed(true)}
            onStop={() => {
              invoke('audio_stop').catch(console.error);
              useStore.getState().setPlaying(false);
              useStore.getState().setLoaded(null, 0);
              setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
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

        {/* Update banner */}
        {pendingUpdate && (
          <div style={{
            height: 24, flexShrink: 0,
            background: 'var(--accent-dim)', borderTop: '1px solid var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 12px', gap: 8,
          }}>
            <span style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>
              {isInstalling ? 'Installing update…' : `Update v${pendingUpdate.version} available`}
            </span>
            {!isInstalling && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={async () => {
                    setIsInstalling(true);
                    await pendingUpdate.downloadAndInstall().catch(console.error);
                    toast('Update installed — restart the app to apply', 6000);
                    setPendingUpdate(null);
                    setIsInstalling(false);
                  }}
                  style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace", textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                >
                  Install
                </button>
                <button
                  onClick={() => setPendingUpdate(null)}
                  style={{ fontSize: 10, color: 'var(--text-3)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        <div style={{
          height: 22, background: 'var(--bg-0)', borderTop: '1px solid var(--border-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', flexShrink: 0,
        }}>
          <span className="font-mono text-[9px] text-mm-t2 flex items-center gap-2">
            Melomaniac by Soupa | v1.0 Alpha | Rust + Tauri | GPLv3 | Syncing: <span style={{ color: 'var(--text-3)' }}>N/A</span>
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
            currentFolderId={folderAssignments[folderPopupItem.id]}
            onClose={() => setFolderPopupItem(null)}
            onAddToFolder={(itemId, folderId) => {
              setFolderAssignments(prev => ({ ...prev, [itemId]: folderId }));
              setMeloToast(`Added to ${folders.find(f => f.id === folderId)?.name ?? 'folder'}`);
              setTimeout(() => setMeloToast(null), 2400);
            }}
            onCreateFolder={(name, itemId) => {
              const id = Date.now();
              setFolders(f => [...f, { id, name }]);
              setFolderAssignments(prev => ({ ...prev, [itemId]: id }));
              setMeloToast(`Folder "${name}" created`);
              setTimeout(() => setMeloToast(null), 2400);
            }}
            onRemoveFromFolder={itemId => {
              removeFromFolder(itemId);
              setMeloToast('Removed from folder');
              setTimeout(() => setMeloToast(null), 2400);
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
              setMeloToast('Playlist artwork updated');
              setTimeout(() => setMeloToast(null), 2400);
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


        {mergeAnim.mounted && activePlaylist && (
          <MergeBranchModal
            closing={mergeAnim.closing}
            playlist={activePlaylist}
            targetBranch={activeBranch}
            targetTrackHashes={(playlistTracks ?? []).map(t => t.hash)}
            targetDescription={branchMeta?.description ?? null}
            onClose={() => setShowMergeModal(false)}
            onMerged={commitHash => {
              setShowMergeModal(false);
              reloadPlaylists();
              invoke<TrackRecord[]>('playlist_get_tracks', {
                playlistId: activePlaylist.id, branchName: activeBranch,
              }).then(r => setPlaylistTracks(r.map(trackRecordToTrack))).catch(console.error);
              invoke<{ description: string | null }>('playlist_get_meta', {
                playlistId: activePlaylist.id, branchName: activeBranch,
              }).then(m => setBranchMeta({ description: m.description })).catch(console.error);
              setCommitRefreshKey(k => k + 1);
              setMeloToast(`Merged into '${activeBranch}' · ${commitHash.slice(0, 7)}`);
              setTimeout(() => setMeloToast(null), 2800);
            }}
          />
        )}

        {forkAnim.mounted && activePlaylist && (
          <ForkPlaylistModal
            closing={forkAnim.closing}
            source={activePlaylist}
            onClose={() => setShowForkModal(false)}
            onForked={newPlaylist => {
              setShowForkModal(false);
              reloadPlaylists();
              setActivePlaylistId(newPlaylist.id);
              setActiveBranch('main');
              setMeloToast(`Forked to '${newPlaylist.name}'`);
              setTimeout(() => setMeloToast(null), 2400);
            }}
          />
        )}

        {branchAnim.mounted && activePlaylist && (
          <BranchModal
            closing={branchAnim.closing}
            playlistId={activePlaylist.id}
            playlistName={activePlaylist.name}
            branchName={activeBranch}
            onClose={() => setShowBranchModal(false)}
            onCreate={name => {
              reloadPlaylists();
              setActiveBranch(name);
              setCommitRefreshKey(k => k + 1);
              setMeloToast(`Branch '${name}' created`);
              setTimeout(() => setMeloToast(null), 2400);
            }}
          />
        )}

        {settingsAnim.mounted && (
          <SettingsModal
            closing={settingsAnim.closing}
            settings={settings}
            updateSetting={handleUpdateSetting}
            onClose={() => setShowSettings(false)}
            onReset={() => { updateSetting(SETTING_DEFAULTS); setShowSettings(false); }}
            onPairDevice={() => { setShowSettings(false); openPairingDisplay().catch(console.error); }}
          />
        )}

        {commitGraphAnim.mounted && (
          <CommitGraph
            closing={commitGraphAnim.closing}
            onClose={() => { setShowCommitGraph(false); setRailItem('playlists'); }}
          />
        )}

        <DiffViewer platform="desktop" />
        <PairingModal platform="desktop" />
        <PeerPlaylistsModal platform="desktop" />

        {/* Melo operation toast */}
        {syncToast && (
          <div style={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-1)', border: '1px solid var(--border-2)',
            borderRadius: 6, padding: '7px 14px',
            fontSize: 11, color: 'var(--accent-light)',
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            pointerEvents: 'none', zIndex: 100,
            animation: 'fadeIn 0.2s ease',
          }}>{syncToast}</div>
        )}

        {meloToast && (
          <div style={{
            position: 'absolute', bottom: loadedHash ? 92 : 30, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-5)', border: '1px solid var(--border-2)',
            borderRadius: 6, padding: '7px 14px',
            fontSize: 11, color: 'var(--accent-light)',
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            pointerEvents: 'none', zIndex: 100,
            animation: 'fadeIn 0.2s ease',
          }}>{meloToast}</div>
        )}
      </div>
    </div>
  );
}
