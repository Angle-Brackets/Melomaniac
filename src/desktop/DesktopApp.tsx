import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './style.css';
import { applyTheme, writeCustomHue, NAMED_THEMES } from '../shared/themes';
import type { ThemeName } from '../shared/themes';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check as checkForUpdate } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAccentsFromUrl, useGlowFade, withAlpha } from '../shared/artworkAccents';
import { ALBUMS, trackRecordToTrack, playlistRecordToPlaylist } from './data';
import type { Track, Playlist, TrackRecord, PlaylistRecord } from './data';
import { useActiveSpotifyRows } from '../store/useActiveSpotifyRows';
import type { SpotifyRow } from '../store/spotifySlice';
import type { AppSettings, ShuffleMode } from './types';
import { LoopMode, Density, DefaultView } from './types';

import TitleBar from './components/TitleBar';
import LibrarySidebar, { AddToFolderPopup } from './components/Sidebar';
import Carousel from './components/Carousel';
import PlaylistHeader from './components/PlaylistHeader';
import PlayerControls from './components/PlayerControls';
import TrackList from './components/TrackList';
import RightPanel from './components/RightPanel';
import { CommitGraph, CommitGraphInline } from './components/CommitGraph';
import BranchModal from './components/BranchModal';
import SettingsModal from './components/SettingsModal';
import PlaylistSettingsPanel from './components/PlaylistSettingsPanel';
import EditorView from './components/EditorView';
import LibraryView from './components/LibraryView';
import SpotifyPlaylistView from './components/SpotifyPlaylistView';
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
import { fisherYates, pickWeighted, pickDiscovery, pickSmart, pickFavorites } from '../store/shuffleAlgorithms';

export type { AppSettings };

// ── Shuffle algorithms ────────────────────────────────────────────────────────
// Picking math lives in ../store/shuffleAlgorithms.ts, shared with mobile's queueSlice —
// these wrappers just map Track[] <-> hash[] around the shared hash-generic functions.

// Desktop's Discovery tier-fallback threshold is a fixed constant (unlike mobile's
// lookahead-sized incremental refill) — this build is always a one-shot full-list shuffle.
const DISCOVERY_MIN_TIER = 20;

function smartShuffle(tracks: Track[]): Track[] {
  const byHash = new Map(tracks.map(t => [t.hash, t]));
  const hashToArtist = new Map(tracks.map(t => [t.hash, t.artist || '?']));
  const hashes = tracks.map(t => t.hash);
  const picks = pickSmart(hashes, hashToArtist, [], hashes.length);
  return picks.map(h => byHash.get(h)!);
}

function weightedShuffle(tracks: Track[], playCounts: Map<string, number>): Track[] {
  const byHash = new Map(tracks.map(t => [t.hash, t]));
  const hashes = tracks.map(t => t.hash);
  const picks = pickWeighted(hashes, playCounts, hashes.length);
  return picks.map(h => byHash.get(h)!);
}

function discoveryShuffle(tracks: Track[], playCounts: Map<string, number>): Track[] {
  if (tracks.length === 0) return [];
  const byHash = new Map(tracks.map(t => [t.hash, t]));
  const hashes = tracks.map(t => t.hash);
  const picks = pickDiscovery(hashes, playCounts, hashes.length, DISCOVERY_MIN_TIER);
  return picks.map(h => byHash.get(h)!);
}

function favoritesShuffle(tracks: Track[], playCounts: Map<string, number>, favorites: Set<string>): Track[] {
  const byHash = new Map(tracks.map(t => [t.hash, t]));
  const hashes = tracks.map(t => t.hash);
  const picks = pickFavorites(hashes, playCounts, favorites, hashes.length);
  return picks.map(h => byHash.get(h)!);
}

function buildShuffledQueue(
  tracks: Track[], mode: ShuffleMode, playCounts?: Map<string, number>, favorites?: Set<string>,
): Track[] {
  if (mode === 'smart') return smartShuffle(tracks);
  if (mode === 'weighted') return weightedShuffle(tracks, playCounts ?? new Map());
  if (mode === 'discovery') return discoveryShuffle(tracks, playCounts ?? new Map());
  if (mode === 'favorites') return favoritesShuffle(tracks, playCounts ?? new Map(), favorites ?? new Set());
  return fisherYates(tracks);
}

// ── Default settings ──────────────────────────────────────────────────────────
const SETTING_DEFAULTS: AppSettings = {
  theme: 'warm',
  accentHue: 28,
  showRightPanel: false,
  carouselSize: 210,
  density: Density.Relaxed,
  defaultView: DefaultView.Tracks,
  discordEnabled: false,
  commitAuthor: '',
  shuffleMode: 'fisher-yates',
  privacyMode: false,
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
  const spotifyToast              = useStore(s => s.spotifyToast);
  const refreshLivePeers         = useStore(s => s.refreshLivePeers);
  const refreshKnownDevices      = useStore(s => s.refreshKnownDevices);
  const loadPlaylists            = useStore(s => s.loadPlaylists);
  const loadLibrary              = useStore(s => s.loadLibrary);
  const setDownloadProgress      = useStore(s => s.setDownloadProgress);
  const artworkVersion           = useStore(s => s.artworkVersion);
  const syncVersion              = useStore(s => s.syncVersion);
  const promotedSpotifySources   = useStore(s => s.promotedSpotifySources);
  const pendingConflictPlaylists = useStore(s => s.pendingConflictPlaylists);
  const reopenConflict           = useStore(s => s.reopenConflict);
  const isPlaying  = useStore(s => s.isPlaying);
  const loadedHash = useStore(s => s.loadedTrackHash);
  const durationMs = useStore(s => s.duration_ms);
  const refreshSpotifyStatus = useStore(s => s.refreshSpotifyStatus);
  const fetchImportedTracks  = useStore(s => s.fetchImportedTracks);
  const openSpotifyPlaylist  = useStore(s => s.openSpotifyPlaylist);
  const closeSpotifyPlaylist = useStore(s => s.closeSpotifyPlaylist);
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
  const [activeTab, setActiveTab] = useState<string>(DefaultView.Tracks);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('melomaniac.pinned') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const [trackOrder, setTrackOrder] = useState<Track[]>([]);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [abA, setAbA] = useState(0);
  const [abB, setAbB] = useState(1);
  const [loopMode, setLoopMode] = useState<LoopMode>(LoopMode.Off);
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
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

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

  // Resolved local tracks for the currently-browsed Spotify virtual playlist, in
  // playlist order — this is the "queue" a track played from SpotifyPlaylistView
  // belongs to, kept separate from playQueue/activeQueue (which is about the
  // real-playlist/library carousel, not the Spotify view).
  const spotifySource = activePlaylistId?.startsWith('spotify:') ? activePlaylistId.slice('spotify:'.length) : null;
  const spotifyRows = useActiveSpotifyRows(spotifySource);
  const spotifyPlaybackQueue = useMemo(
    () => spotifyRows
      .filter((r): r is Extract<SpotifyRow, { kind: 'local' }> => r.kind === 'local')
      .map((r, idx) => trackRecordToTrack(r.track, idx)),
    [spotifyRows],
  );

  const carouselAlbums = useMemo(
    () => playQueue.map(t => ({
      ...(ALBUMS[t.albumRef] ?? ALBUMS[0]),
      artworkUrl: artworkUrls[t.hash] ?? null,
    })),
    [playQueue, artworkUrls],
  );
  const carouselIdx = Math.max(0, playQueue.findIndex(t => t.id === activeTrackId));
  // The track the mini-player should display. Prefers the loaded/playing track,
  // looked up in the full library by hash (so it resolves regardless of what
  // playlist is currently browsed), over the browsed queue's spotlighted
  // position — otherwise switching away from the playing playlist would make
  // the mini-player "forget" what's playing, since `activeTrackId` no longer
  // matches anything in the newly-viewed queue.
  const nowPlayingTrack = (loadedHash && trackOrder.find(t => t.hash === loadedHash))
    || playQueue.find(t => t.id === activeTrackId)
    || null;
  // The track the CAROUSEL/main player should display — always whatever's
  // spotlighted in the browsed queue, regardless of what's actually playing.
  // Distinct from `nowPlayingTrack` (mini-player only): browsing to a
  // different track/playlist than what's playing should show that browsed
  // track's own title/artist/duration, not silently substitute the playing
  // track's info.
  const browsedTrack = playQueue[carouselIdx] ?? null;
  const isActiveLoaded = !!loadedHash && browsedTrack?.hash === loadedHash;
  const activeArtworkUrl = artworkUrls[playQueue[carouselIdx]?.hash ?? ''] ?? null;
  const artworkAccents = useAccentsFromUrl(activeArtworkUrl);
  const { slots: glowSlots, activeSlot: glowActive } = useGlowFade(artworkAccents);

  // Stale-closure ref — updated synchronously each render so the audio event
  // listener (which is registered once) always reads the latest values.
  const sr = useRef({
    loopMode, playQueue, activeQueue, loadedHash, manualQueue,
    abA, abB, durationMs, positionMs, activeTrackId,
    isShuffle, shuffleMode: settings.shuffleMode, favorites,
    // The queue/context the CURRENTLY LOADED track actually belongs to — deliberately
    // NOT synced every render like the fields above. `playQueue`/`activeQueue` track
    // whatever's being VIEWED (they're derived from activePlaylistId, which changes
    // just by navigating), so using them for skip/next/prev/auto-advance would let
    // browsing to a different playlist (or the Spotify view) hijack playback to an
    // unrelated track. These fields are only written at deliberate "start/continue
    // playing this queue" moments (see snapshotPlayingQueue below) so navigation
    // elsewhere never affects what's actually playing.
    playingQueue: playQueue as Track[],
    playingActiveQueue: activeQueue as Track[],
    playingPlaylistId: null as string | null,
    playingBranchName: 'main',
    playingIsShuffle: false,
    viewedPlaylistId: null as string | null,
    viewedBranchName: 'main',
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
  sr.current.favorites      = favorites;
  // The `spotify:` sentinel isn't a real playlist context (its queue falls back
  // to the library, same as browsing nothing) — mirrors `resolvePlayingContext` below.
  sr.current.viewedPlaylistId = activePlaylistId && !activePlaylistId.startsWith('spotify:') ? activePlaylistId : null;
  sr.current.viewedBranchName = activePlaylistId && !activePlaylistId.startsWith('spotify:') ? activeBranch : 'main';

  // Records which queue/context a deliberate track-selection came from, so skip/
  // next/prev/auto-advance keep operating on the queue that's actually playing
  // regardless of what the user browses to afterward. `playlistId: null` means
  // "library context" (mirrors the existing SavedPlaybackState convention) —
  // used for the Spotify view too, since its queue isn't a real playlist.
  const snapshotPlayingQueue = (queue: Track[], activeQ: Track[], playlistId: string | null, branchName: string, shuffled: boolean) => {
    sr.current.playingQueue = queue;
    sr.current.playingActiveQueue = activeQ;
    sr.current.playingPlaylistId = playlistId;
    sr.current.playingBranchName = branchName;
    sr.current.playingIsShuffle = shuffled;
    // Temporary "remove from upcoming" exclusions belong to this specific
    // playing session, not to whatever's being browsed — reset them here
    // (a fresh deliberate queue/track pick) rather than on mere navigation,
    // so browsing away and back no longer un-does them.
    setSessionExcluded(new Set());
  };

  // True when the queue the user is currently VIEWING is the same one that's
  // actually playing — i.e. it's safe to let the Carousel/TrackList follow
  // along with skip/prev/auto-advance. False while browsing elsewhere, so
  // those don't jerk the carousel to an unrelated position in a different
  // playlist just because playback advanced somewhere out of view.
  const isViewingPlayingContext = () =>
    sr.current.viewedPlaylistId === sr.current.playingPlaylistId &&
    sr.current.viewedBranchName === sr.current.playingBranchName;

  // The queue that's actually playing (falls back to the browsed `playQueue`
  // only before anything's ever been snapshotted, e.g. very first launch) —
  // used anywhere that should reflect real playback rather than whatever's
  // merely being browsed (the "Up Next" queue panel, skip/prev source).
  const nowPlayingQueue = sr.current.playingQueue.length > 0 ? sr.current.playingQueue : playQueue;

  // Keeps `activeTrackId` meaningfully in sync with whatever queue is now
  // being browsed. Without this, navigating to a new playlist leaves
  // `activeTrackId` pointing at a stale positional id left over from the
  // previous queue (ids are only unique within the array they were derived
  // from — see trackRecordToTrack), which caused two bugs: the Carousel not
  // jumping to the actually-playing track when you return to its playlist,
  // and pressing Play right after navigating hijacking whatever's currently
  // loaded instead of starting the newly-viewed track. Declared here — well
  // before the cold-start restore effects further down — so that on cold
  // start those effects' own setActiveTrackId calls run after this one in
  // the same commit and correctly take precedence as the "last word".
  useEffect(() => {
    if (activeQueue.length === 0) return;
    if (isViewingPlayingContext()) {
      const playing = activeQueue.find(t => t.hash === loadedHash);
      setActiveTrackId(playing ? playing.id : activeQueue[0].id);
    } else {
      setActiveTrackId(activeQueue[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue]);

  // Refs that hold the latest skip handlers so the audio event listener can
  // call them without stale closures.
  const skipNextRef    = useRef<() => void>(() => {});
  const skipPrevRef    = useRef<() => void>(() => {});
  const abCommitRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playCountsRef  = useRef<Map<string, number>>(new Map());

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
  const enterBigPicture = useCallback(() => setBigPicture(true), []);
  const exitBigPicture = useCallback(() => setBigPicture(false), []);

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
      .then((pos) => {
        // pos > 0: audio is genuinely still running (Windows WebView2 frontend restart).
        // pos === 0: cold start — AtomicU64 is just zeroed, no track actually loaded.
        pendingRestoreRef.current = pos > 0 ? saved : { ...saved, coldStart: true };
      })
      .catch(() => {
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
    // Also re-poll knownDevices here: an inbound QR pairing (peer scans our
    // code and POSTs to our /pair endpoint) updates the trust list on disk
    // with no frontend notification, so the store's copy goes stale until
    // we re-fetch it.
    const id = setInterval(() => {
      refreshLivePeers()
      refreshKnownDevices()
    }, 15_000)
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
  useEffect(() => { refreshSpotifyStatus(); }, []);
  // Populate `importedTracks` up front (not just when the Library tab is
  // visited) so the sidebar's Spotify track counts are accurate — a
  // playlist's real, already-imported count overrides Spotify's raw API
  // total, which includes local files it can't hand us the audio for.
  useEffect(() => { fetchImportedTracks(); }, []);
  // The above `reloadLibrary` only populates this component's own local
  // `trackOrder` state — it never touches the store's `s.tracks`, which
  // `useActiveSpotifyRows` reads to resolve a Spotify track's `matched_hash`
  // to a local `TrackRecord`. Without this, `s.tracks` stays empty on
  // startup and every already-linked Spotify row renders as if it were
  // still unmatched, until some unrelated action (e.g. a single-track
  // download) happens to call the store's `loadLibrary()` for the first time.
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

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
      let restoredQueue: Track[];
      if (r.shuffledHashes?.length) {
        const validSet = new Set(trackOrder.map(t => t.hash));
        const restored = r.shuffledHashes
          .filter(h => validSet.has(h))
          .map(h => trackOrder.find(t => t.hash === h)!);
        restoredQueue = restored.length > 0 ? restored : buildShuffledQueue(trackOrder, r.shuffleMode, playCountsRef.current, favorites);
      } else {
        restoredQueue = buildShuffledQueue(trackOrder, r.shuffleMode, playCountsRef.current, favorites);
      }
      setShuffledQueue(restoredQueue);
      snapshotPlayingQueue(restoredQueue, trackOrder, null, 'main', true);
    } else {
      snapshotPlayingQueue(trackOrder, trackOrder, null, 'main', false);
    }
    pendingRestoreRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackOrder]);

  // ── Refresh library when a download completes ────────────────────────────
  useEffect(() => {
    const unsub = listen('download://done', () => reloadLibrary());
    return () => { unsub.then(fn => fn()); };
  }, [reloadLibrary]);

  // ── Forward Rust sync progress events to the store ───────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ playlist_id: string; done: number; total: number }>('sync://progress', ({ payload }) => {
      const pct = payload.total > 0 ? payload.done / payload.total : 0;
      setDownloadProgress(payload.playlist_id, pct);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [setDownloadProgress]);

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

  // When a Spotify virtual playlist is promoted into a real one, the new
  // playlist is created entirely inside spotifySlice — nothing in this
  // component's own action handlers triggers a reload for it, so without
  // this it'd only show up in the sidebar after something else (e.g. a
  // manual playlist edit) happened to call reloadPlaylists.
  useEffect(() => {
    if (promotedSpotifySources.length > 0) reloadPlaylists();
  }, [promotedSpotifySources, reloadPlaylists]);

  // When a sync downloads a new playlist, refresh the local playlist list.
  useEffect(() => {
    if (syncVersion > 0) reloadPlaylists();
  }, [syncVersion, reloadPlaylists]);

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
  // Bumped on every playlist/branch change so a slow or out-of-order fetch
  // resolving after a newer switch can detect it's stale and no-op instead of
  // clobbering state with tracks from a playlist that's no longer active.
  const playlistTracksReqRef = useRef(0);

  useEffect(() => {
    const playlistChanged = prevPlaylistIdRef.current !== activePlaylistId;
    prevPlaylistIdRef.current = activePlaylistId;

    if (playlistChanged) {
      // Returning to view the playlist/library context that's actually
      // playing should keep showing it in the order it's playing in
      // (including shuffle) instead of resetting to unshuffled — restoring
      // here, ahead of the fetch below resolving, avoids a flash of
      // unshuffled order. It's re-keyed onto the freshly-fetched tracks
      // once that fetch lands (see the `playlistChanged` branch there),
      // since this uses the last snapshot's Track objects, not fresh ones.
      if (isViewingPlayingContext() && sr.current.playingIsShuffle) {
        setShuffledQueue(sr.current.playingQueue);
        setIsShuffle(true);
      } else {
        setShuffledQueue(null);
        setIsShuffle(false);
      }
    }

    // The `spotify:` sentinel exists only so the sidebar can highlight the active
    // virtual-playlist row — it isn't a real playlist ID, so there's nothing to
    // fetch here. Falling through to `playlist_get_tracks` would 404 and clear
    // `playlistTracks` to `[]`, which (unlike `null`) does NOT fall back to the
    // full library in `activeQueue`, silently emptying the playback queue/mini
    // player while browsing a Spotify playlist.
    if (!activePlaylistId || activePlaylistId.startsWith('spotify:')) { setPlaylistTracks(null); setBranchMeta(null); return; }

    // Clear the outgoing playlist's tracks immediately rather than leaving them
    // displayed (and playable) until the fetch below resolves — otherwise a
    // click in that window can select/play a track that still belongs to the
    // PREVIOUS playlist while activePlaylistId/sidebar/header already reflect
    // the new one, which is exactly what produced the reported "clicking a
    // track in the newly-selected playlist just pauses/skips within the old
    // one" bug.
    if (playlistChanged) setPlaylistTracks(null);

    const reqId = ++playlistTracksReqRef.current;
    invoke<TrackRecord[]>('playlist_get_tracks', {
      playlistId: activePlaylistId,
      branchName: activeBranch,
    })
      .then(records => {
        if (reqId !== playlistTracksReqRef.current) return; // superseded by a newer switch
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
          setShuffledQueue(q => q ? buildShuffledQueue(newTracks, sr.current.shuffleMode, playCountsRef.current, favorites) : null);
        }
        // Returning to the actively-playing (shuffled) playlist — re-key the
        // provisional restore above (which used the last snapshot's Track
        // objects) onto these freshly-fetched ones, preserving the exact same
        // order, so downstream state (edits, artwork, etc.) works off current
        // data instead of a stale snapshot.
        if (playlistChanged && isViewingPlayingContext() && sr.current.playingIsShuffle) {
          const byHash = new Map(newTracks.map(t => [t.hash, t] as const));
          const reordered = sr.current.playingQueue
            .map(t => byHash.get(t.hash))
            .filter((t): t is Track => t !== undefined);
          if (reordered.length > 0) setShuffledQueue(reordered);
        }
      })
      .catch(() => { if (reqId === playlistTracksReqRef.current) setPlaylistTracks([]); });

    invoke<{ description: string | null }>('playlist_get_meta', {
      playlistId: activePlaylistId,
      branchName: activeBranch,
    })
      .then(meta => { if (reqId === playlistTracksReqRef.current) setBranchMeta({ description: meta.description }); })
      .catch(() => { if (reqId === playlistTracksReqRef.current) setBranchMeta(null); });
  }, [activePlaylistId, activeBranch]); // eslint-disable-line react-hooks/exhaustive-deps

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
      let restoredQueue: Track[];
      if (r.shuffledHashes?.length) {
        const validSet = new Set(playlistTracks.map(t => t.hash));
        const restored = r.shuffledHashes
          .filter(h => validSet.has(h))
          .map(h => playlistTracks.find(t => t.hash === h)!);
        restoredQueue = restored.length > 0 ? restored : buildShuffledQueue(playlistTracks, r.shuffleMode, playCountsRef.current, favorites);
      } else {
        restoredQueue = buildShuffledQueue(playlistTracks, r.shuffleMode, playCountsRef.current, favorites);
      }
      setShuffledQueue(restoredQueue);
      snapshotPlayingQueue(restoredQueue, playlistTracks, activePlaylistId, activeBranch, true);
    } else {
      snapshotPlayingQueue(playlistTracks, playlistTracks, activePlaylistId, activeBranch, false);
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

  useEffect(() => {
    invoke('audio_set_privacy_mode', { enabled: settings.privacyMode }).catch(console.error);
  }, [settings.privacyMode]);

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
      // Only follow along in the Carousel/TrackList if the user is currently
      // looking at the queue that's actually playing — otherwise auto-advance
      // would jump the carousel to an unrelated position in whatever playlist
      // happens to be browsed.
      if (isViewingPlayingContext()) setActiveTrackId(track.id);
      useStore.getState().setLoaded(track.hash, track.duration_ms);
      sr.current.durationMs = track.duration_ms;
      setPositionMs(0);
      livePositionMsRef.current = 0;
      hasRecordedPlayRef.current = false;
      useStore.getState().setPlaying(true);
      playHash(track.hash, track.title);
    };

    let unlisten: (() => void) | undefined;
    listen<AudioPayload>('audio://event', ({ payload }) => {
      if (typeof payload === 'object' && 'PositionChanged' in payload) {
        const posMs = payload.PositionChanged;
        // ── A·B loop enforcement — runs regardless of seek throttle ──────────
        const { loopMode: lm, abA: a, abB: b, durationMs: dur } = sr.current;
        if (lm === LoopMode.AB && dur > 0 && posMs >= b * dur) {
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

        if (lm === LoopMode.One) {
          if (lh) playHash(lh);
          hasRecordedPlayRef.current = false; // reset so each loop iteration counts
          useStore.getState().setPlaying(true);
          return;
        }
        if (lm === LoopMode.AB) {
          const aMs = Math.floor(a * dur);
          lastSeekTime.current = Date.now();
          setPositionMs(aMs);
          invoke('audio_seek', { positionMs: aMs }).catch(console.error);
          useStore.getState().resumeAudio().catch(console.error);
          return;
        }

        // loopMode 'off' — auto-advance. Uses `playingQueue`/`playingActiveQueue`/
        // `playingIsShuffle` (the queue/shuffle-state the ending track actually
        // came from), NOT the live `playQueue`/`activeQueue`/`isShuffle` (whatever's
        // currently being browsed) — otherwise a track ending while the user is
        // looking at a different playlist/the Spotify view would advance into an
        // unrelated queue, or wrap/reshuffle based on the wrong shuffle toggle.
        const { manualQueue: mq, playingQueue: pq, playingActiveQueue: aq,
                playingIsShuffle: shuffle, shuffleMode: sm, activeTrackId: atid,
                favorites: favs } = sr.current;

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
            const newQ = buildShuffledQueue(aq, sm, playCountsRef.current, favs);
            // Avoid immediately repeating the just-finished track at position 0.
            if (newQ.length > 1 && newQ[0].hash === lh) [newQ[0], newQ[1]] = [newQ[1], newQ[0]];
            // Canonical playing order always gets the reshuffle, regardless of
            // what's browsed. Only mirror it into the browsed view's own state
            // if that view is actually showing the playing context — otherwise
            // this would hijack an unrelated playlist's carousel/track order.
            sr.current.playingQueue = newQ;
            if (isViewingPlayingContext()) setShuffledQueue(newQ);
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
  // Tracks which (hash, artwork_hash) pairs have been fetched/in-flight so we
  // never duplicate requests. Keying on the pair rather than just the track
  // hash matters for freshly-downloaded Spotify tracks: the metadata-apply
  // step can overwrite artwork_hash shortly after the track first appears in
  // the queue (with a null/placeholder hash), and keying on hash alone would
  // treat that as "already fetched" and never pick up the real artwork.
  const fetchedHashesRef = useRef(new Set<string>());
  // `track_get_artwork` takes only the track hash (Rust looks up the CURRENT
  // artwork_hash from the DB), so two in-flight requests for the same track
  // hash aren't correlated by payload — the response can't tell which
  // dispatch it belongs to. A freshly-downloaded Spotify track can trigger
  // an early request (queue update right after the file lands, before
  // metadata/artwork apply) and a later one (after apply completes); if the
  // early one's IPC round-trip happens to resolve after the later one, it
  // would silently overwrite the correct artwork with the stale version.
  // This ref records, per track hash, the artwork_hash that was current at
  // the moment each request was dispatched — a response is only applied if
  // that's still the latest dispatched value by the time it resolves.
  const latestArtworkHashRef = useRef(new Map<string, string>());
  useEffect(() => {
    // When artworkVersion bumps (sync downloaded new artwork under the same
    // hash), clear the guard so all tracks get re-fetched with fresh data URLs.
    if (artworkVersion > 0) fetchedHashesRef.current.clear();
    for (const track of playQueue) {
      if (!track?.artwork_hash) continue;
      const key = `${track.hash}:${track.artwork_hash}`;
      if (fetchedHashesRef.current.has(key)) continue;
      fetchedHashesRef.current.add(key);
      const expectedArtworkHash = track.artwork_hash;
      latestArtworkHashRef.current.set(track.hash, expectedArtworkHash);
      invoke<string>('track_get_artwork', { hash: track.hash })
        .then(dataUrl => {
          if (latestArtworkHashRef.current.get(track.hash) !== expectedArtworkHash) return;
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
  // Reads `sr.current.playingPlaylistId`/`playingBranchName` (the context the
  // PLAYING track actually belongs to) rather than `activePlaylistId`/`activeBranch`
  // (whatever's currently being BROWSED) — otherwise merely navigating to a
  // different playlist/the Spotify view while something plays elsewhere would
  // overwrite the saved context with the wrong values, corrupting cold-start restore.
  useEffect(() => {
    return useStore.subscribe(state => {
      if (state.loadedTrackHash) {
        localStorage.setItem('melomaniac.playback_state', JSON.stringify({
          hash: state.loadedTrackHash, durationMs: state.duration_ms,
          playlistId: sr.current.playingPlaylistId, branchName: sr.current.playingBranchName,
          isShuffle, shuffleMode: settings.shuffleMode,
          shuffledHashes: isShuffle && shuffledQueue ? shuffledQueue.map(t => t.hash) : undefined,
          loopMode,
        } satisfies SavedPlaybackState));
      } else {
        localStorage.removeItem('melomaniac.playback_state');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShuffle, settings.shuffleMode, shuffledQueue, loopMode]);

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

  // Every playback entry point (row click, skip, resume, Spotify view, loop)
  // funnels through this instead of a bare `invoke` so a missing/purged blob
  // surfaces as a toast rather than a silent console error.
  const playHash = (hash: string, title?: string) => {
    invoke('track_play', { hash }).catch(e => {
      console.error('track_play failed:', e);
      toast(title ? `Couldn't play "${title}" — ${e}` : `Couldn't play track — ${e}`, 3000);
    });
  };

  // off → fisher-yates → smart → weighted → discovery → favorites → off
  const handleShuffle = async () => {
    const applyMode = (mode: ShuffleMode, label: string) => {
      updateSetting('shuffleMode', mode);
      const newQ = buildShuffledQueue(activeQueue, mode, playCountsRef.current, favorites);
      sr.current.isShuffle = true;
      setShuffledQueue(newQ);
      setIsShuffle(true);
      // If this view is also the one actually playing, keep the playing
      // snapshot in sync too — otherwise skip/prev/auto-advance would keep
      // using the pre-toggle order until the next deliberate track pick,
      // and navigating away and back would restore the stale order instead
      // of this new shuffle.
      if (isViewingPlayingContext()) {
        sr.current.playingQueue = newQ;
        sr.current.playingIsShuffle = true;
      }
      toast(`Shuffle: ${label}`);
    };

    if (!isShuffle) {
      applyMode('fisher-yates', 'True Shuffle');
    } else if (settings.shuffleMode === 'fisher-yates') {
      applyMode('smart', 'Smart');
    } else if (settings.shuffleMode === 'smart') {
      try {
        const stats = await invoke<[string, { play_count: number }][]>('library_get_all_track_stats');
        playCountsRef.current = new Map(stats.map(([h, s]) => [h, s.play_count]));
      } catch { /* fall back to empty map — treats all counts as 0 */ }
      applyMode('weighted', 'Weighted');
    } else if (settings.shuffleMode === 'weighted') {
      applyMode('discovery', 'Discovery');
    } else if (settings.shuffleMode === 'discovery') {
      applyMode('favorites', 'Favorites');
    } else {
      sr.current.isShuffle = false;
      setShuffledQueue(null);
      setIsShuffle(false);
      if (isViewingPlayingContext()) {
        sr.current.playingQueue = activeQueue;
        sr.current.playingIsShuffle = false;
      }
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
      setActiveTab(DefaultView.Tracks);
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
    const next = m === LoopMode.Off ? LoopMode.One : m === LoopMode.One ? LoopMode.AB : LoopMode.Off;
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
    if (item === 'editor') {
      setActiveTab(DefaultView.Tracks);
      // Lock in a concrete track so playback changes never hijack the editor display.
      setEditorTrackId(prev => prev ?? activeTrackId);
    }
  };

  const handleSelectTrack = (id: number) => {
    setActiveTrackId(id);
  };

  // Play a track from the currently-browsed Spotify virtual playlist. Unlike
  // the old inline `playTrack` in SpotifyPlaylistView (which only called
  // `track_play` + local row-highlight state), this pairs it with `setLoaded`/
  // `setPlaying` like every other play path in the app — otherwise the
  // mini-player never reflected Spotify-originated playback at all. It also
  // snapshots the Spotify view's own resolved-local-tracks order as the
  // playing queue, so skip next/prev advance through this playlist correctly
  // even after navigating elsewhere.
  const handleSpotifyPlayTrack = (hash: string) => {
    const track = spotifyPlaybackQueue.find(t => t.hash === hash);
    if (!track) return;
    playHash(hash, track.title);
    useStore.getState().setLoaded(hash, track.duration_ms);
    sr.current.durationMs = track.duration_ms;
    snapshotPlayingQueue(spotifyPlaybackQueue, spotifyPlaybackQueue, null, 'main', false);
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
    useStore.getState().setPlaying(true);
  };

  // `playQueue`/`activeQueue` fall back to the full library while browsing the
  // Spotify sentinel (see the playlistTracks-fetch effect), so that fallback is
  // library context (`playlistId: null`), not the Spotify view itself.
  const resolvePlayingContext = (): { playlistId: string | null; branchName: string } =>
    activePlaylistId && !activePlaylistId.startsWith('spotify:')
      ? { playlistId: activePlaylistId, branchName: activeBranch }
      : { playlistId: null, branchName: 'main' };

  const handleTrackPlayPause = (id: number) => {
    const track = playQueue.find(t => t.id === id);
    if (!track?.hash) return;
    if (track.hash === loadedHash) {
      // Already loaded — just toggle pause/resume
      useStore.getState().toggleAudio().catch(console.error);
    } else {
      // Different track — load and play it, and record that THIS (the view
      // this row belongs to) is now the queue that's actually playing.
      setActiveTrackId(id);
      playHash(track.hash, track.title);
      useStore.getState().setLoaded(track.hash, track.duration_ms);
      sr.current.durationMs = track.duration_ms;
      { const ctx = resolvePlayingContext(); snapshotPlayingQueue(playQueue, activeQueue, ctx.playlistId, ctx.branchName, isShuffle); }
      useStore.getState().setPlaying(true);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
    }
  };

  const handleSkipNext = () => {
    if (loadedHash)
      invoke('track_record_skip', { hash: loadedHash, positionMs: livePositionMsRef.current }).catch(console.error);
    setLoopMode(LoopMode.Off); sr.current.loopMode = LoopMode.Off;
    // Manual queue takes priority
    if (manualQueue.length > 0) {
      const [next, ...rest] = manualQueue;
      setManualQueue(rest);
      // Only follow along visually if the viewed queue is the one playing —
      // see the rationale above `isViewingPlayingContext`.
      if (isViewingPlayingContext()) setActiveTrackId(next.id);
      playHash(next.hash, next.title);
      useStore.getState().setLoaded(next.hash, next.duration_ms);
      sr.current.durationMs = next.duration_ms;
      useStore.getState().setPlaying(true);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
      return;
    }
    // Advance within the queue that's actually PLAYING (nowPlayingQueue), not
    // whatever's currently being browsed.
    const q = nowPlayingQueue.filter(t => !sessionExcluded.has(t.hash));
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const nextIdx = (idx + 1) % q.length;
    const next = q[nextIdx];
    // Only move the Carousel/TrackList spotlight if we're looking at the queue
    // that's actually advancing — otherwise this would jump the carousel to a
    // coincidental position in whatever unrelated playlist is being browsed.
    if (isViewingPlayingContext()) setActiveTrackId(next.id);
    playHash(next.hash, next.title);
    useStore.getState().setLoaded(next.hash, next.duration_ms);
    sr.current.durationMs = next.duration_ms;
    useStore.getState().setPlaying(true);
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
  };
  skipNextRef.current = handleSkipNext;

  const handleSkipPrev = () => {
    // Restart current track if more than 3 s in — reload is more reliable than seek-to-0
    if (livePositionMsRef.current > 3000 && loadedHash) {
      playHash(loadedHash, nowPlayingQueue.find(t => t.hash === loadedHash)?.title);
      setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
      useStore.getState().setPlaying(true);
      return;
    }
    if (loadedHash)
      invoke('track_record_skip', { hash: loadedHash, positionMs: livePositionMsRef.current }).catch(console.error);
    setLoopMode(LoopMode.Off); sr.current.loopMode = LoopMode.Off;
    // Same rationale as handleSkipNext — use the actually-playing queue.
    const q = nowPlayingQueue;
    let idx = q.findIndex(t => t.hash === loadedHash);
    if (idx === -1) idx = q.findIndex(t => t.id === activeTrackId);
    if (q.length === 0) return;
    const prevIdx = (idx - 1 + q.length) % q.length;
    const prev = q[prevIdx];
    // Same rationale as handleSkipNext — don't jump the carousel unless we're
    // actually looking at the queue that's playing.
    if (isViewingPlayingContext()) setActiveTrackId(prev.id);
    playHash(prev.hash, prev.title);
    useStore.getState().setLoaded(prev.hash, prev.duration_ms);
    sr.current.durationMs = prev.duration_ms;
    useStore.getState().setPlaying(true);
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
  };
  skipPrevRef.current = handleSkipPrev;

  const handlePlayPause = () => {
    // `activeTrackId` is kept meaningfully in sync with the viewed queue by
    // the reconciliation effect above, so it always resolves to a real track
    // in `playQueue` — either the one actually playing (if this view is the
    // one that's playing) or the newly-viewed queue's first track otherwise.
    const queueTrack = playQueue.find(t => t.id === activeTrackId);
    if (loadedHash && (!queueTrack || queueTrack.hash === loadedHash)) {
      // Already loaded and it's the same track (or nothing resolvable in the
      // queue) — just toggle pause/resume.
      useStore.getState().toggleAudio().catch(console.error);
      return;
    }
    if (!queueTrack?.hash) return;
    playHash(queueTrack.hash, queueTrack.title);
    useStore.getState().setLoaded(queueTrack.hash, queueTrack.duration_ms);
    sr.current.durationMs = queueTrack.duration_ms;
    { const ctx = resolvePlayingContext(); snapshotPlayingQueue(playQueue, activeQueue, ctx.playlistId, ctx.branchName, isShuffle); }
    setPositionMs(0); livePositionMsRef.current = 0; hasRecordedPlayRef.current = false;
    useStore.getState().setPlaying(true);
  };

  // Mini-player's play/pause always controls actual playback — unlike the
  // big carousel's handlePlayPause, it must NOT be redirected to whatever's
  // merely browsed, since the mini-player always displays (and should only
  // ever act on) the track that's really loaded.
  const handleMiniPlayPause = () => {
    useStore.getState().toggleAudio().catch(console.error);
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
            onSelectPlaylist={id => { closeSpotifyPlaylist(); setActivePlaylistId(id); setActiveTab(DefaultView.Tracks); setRailItem('playlists'); }}
            onSelectSpotify={source => {
              setActivePlaylistId(`spotify:${source}`);
              setRailItem('playlists');
              openSpotifyPlaylist(source);
            }}
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
            hasUpdate={!!pendingUpdate}
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
                onToast={toast}
              />
            ) : railItem === 'editor' ? (
              <EditorView
                track={trackOrder.find(t => t.id === editorTrackId)}
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
            ) : activePlaylistId?.startsWith('spotify:') ? (
              <SpotifyPlaylistView
                source={activePlaylistId.slice('spotify:'.length)}
                artworkUrls={artworkUrls}
                onPlayTrack={handleSpotifyPlayTrack}
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

                {activeTab === DefaultView.Tracks && (
                  <div style={{ position: 'relative', flex: 1 }}>
                    <div style={{
                      position: 'absolute', left: 0, right: 0, top: 0,
                      bottom: bigPicture ? 0 : `calc(100% - ${topPaneHeight}px)`,
                      overflow: 'hidden', display: 'flex', flexDirection: 'column',
                      background: 'var(--bg-2)',
                      paddingBottom: bigPicture ? 28 : 0,
                      transition: 'bottom 0.4s cubic-bezier(0.4,0,0.2,1), padding-bottom 0.4s ease',
                      zIndex: 2,
                    }}>
                      {/* Artwork bloom — two slots cross-fade so gradient changes animate smoothly
                           (CSS can't interpolate between gradient values, opacity cross-fade instead) */}
                      {glowSlots.map((slot, i) => slot[0] && (
                        <div key={i} style={{
                          position: 'absolute', left: '50%', top: bigPicture ? '45%' : '38%',
                          transform: 'translate(-50%, -50%)',
                          width: '75%', height: bigPicture ? '70%' : '160%',
                          borderRadius: '50%',
                          background: `radial-gradient(ellipse at center, ${withAlpha(slot[0], 0.35)} 0%, ${withAlpha(slot[1], 0.16)} 45%, transparent 70%)`,
                          filter: 'blur(30px)',
                          pointerEvents: 'none',
                          zIndex: 0,
                          opacity: glowActive === i ? 1 : 0,
                          transition: 'opacity 0.9s ease, top 0.4s cubic-bezier(0.4,0,0.2,1), height 0.4s cubic-bezier(0.4,0,0.2,1)',
                        }} />
                      ))}
                      <div style={{ paddingTop: 14, paddingBottom: 4, flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
                        <Carousel
                          albums={carouselAlbums}
                          activeIndex={carouselIdx}
                          onIndexChange={idx => {
                            const t = playQueue[idx];
                            if (t) handleSelectTrack(t.id);
                          }}
                          size={settings.carouselSize}
                          activeGlowColors={artworkAccents}
                          bigPicture={bigPicture}
                          privacyMode={settings.privacyMode}
                        />
                      </div>
                      <div style={{ position: 'relative', zIndex: 1 }}>
                        <PlayerControls
                          track={browsedTrack}
                          positionMsRef={livePositionMsRef}
                          durationMs={durationMs}
                          isPlaying={isPlaying} onPlayPause={handlePlayPause}
                          onSkipNext={handleSkipNext} onSkipPrev={handleSkipPrev}
                          isFav={favorites.has(browsedTrack?.hash ?? '')}
                          onFav={() => {
                            const hash = browsedTrack?.hash;
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
                          isActiveLoaded={isActiveLoaded}
                        />
                      </div>
                    </div>
                    <div style={{
                      position: 'absolute', left: 0, right: 0, bottom: 0, top: topPaneHeight,
                      display: 'flex', flexDirection: 'column',
                      transform: bigPicture ? 'translateY(100%)' : 'translateY(0)',
                      opacity: bigPicture ? 0 : 1,
                      pointerEvents: bigPicture ? 'none' : undefined,
                      transition: 'transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
                      zIndex: 1,
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
                  </div>
                )}

                {activeTab === DefaultView.History && (
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
            playQueue={nowPlayingQueue.filter(t => !sessionExcluded.has(t.hash))}
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
            track={nowPlayingTrack}
            artworkUrl={artworkUrls[loadedHash]}
            isPlaying={isPlaying}
            positionMsRef={livePositionMsRef}
            durationMs={durationMs}
            loopMode={loopMode}
            abA={abA}
            abB={abB}
            volume={volume}
            onPlayPause={handleMiniPlayPause}
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

        {/* Status bar */}
        <div style={{
          height: 22, background: 'var(--bg-0)', borderTop: '1px solid var(--border-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', flexShrink: 0,
        }}>
          <span className="font-mono text-[9px] text-mm-t2 flex items-center gap-2">
            Melomaniac by Soupa | v{__APP_VERSION__} | Rust + Tauri | GPLv3 | Syncing: <span style={{ color: 'var(--text-3)' }}>N/A</span>
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
            pendingUpdate={pendingUpdate}
            isInstalling={isInstalling}
            onInstallUpdate={async () => {
              if (!pendingUpdate) return;
              setIsInstalling(true);
              setUpdateProgress(0);
              let downloaded = 0;
              let total = 0;
              await pendingUpdate.downloadAndInstall(event => {
                if (event.event === 'Started') {
                  total = event.data.contentLength ?? 0;
                } else if (event.event === 'Progress') {
                  downloaded += event.data.chunkLength;
                  setUpdateProgress(total > 0 ? Math.round((downloaded / total) * 100) : null);
                } else if (event.event === 'Finished') {
                  setUpdateProgress(100);
                }
              }).catch(console.error);
              setIsInstalling(false);
              setUpdateReady(true);
            }}
            updateReady={updateReady}
            updateProgress={updateProgress}
            onRelaunch={() => relaunch()}
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

        {spotifyToast && (
          <div style={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg-1)', border: '1px solid var(--border-2)',
            borderRadius: 6, padding: '7px 14px',
            fontSize: 11, color: 'var(--accent-light)',
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease',
          }}>
            <span style={{ pointerEvents: 'none' }}>{spotifyToast.message}</span>
            {spotifyToast.action && (
              <button
                onClick={spotifyToast.action.onClick}
                style={{
                  background: 'none', border: '1px solid var(--border-2)', borderRadius: 4,
                  padding: '2px 8px', color: 'var(--accent-light)', fontSize: 10.5,
                  fontFamily: "'Outfit', sans-serif", cursor: 'pointer',
                }}
              >{spotifyToast.action.label}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
