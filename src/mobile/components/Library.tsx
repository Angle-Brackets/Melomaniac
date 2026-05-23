import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { TrackRecord } from '../../store/types';
import { Icons } from '../icons';
import { MMArt, MMTabBar, MMHash, MMBranchPill, MMSheet, MarqueeText, iconBtn, usePullToRefresh, PullSpinner } from './common';
import type { TabId } from './common';
import type { PlaylistRecord } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef } from '../playerContext';

// ── useHorizDragScroll ─────────────────────────────────────────────────────────
// Enables mouse/pointer drag to scroll horizontal pill rows that have no native
// scrollbar.  `didDrag` distinguishes a real drag from a tap so click handlers
// on child pills are not accidentally triggered after a drag gesture ends.
function useHorizDragScroll() {
  const ref      = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; sl: number } | null>(null);
  const didDrag  = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    startRef.current = { x: e.clientX, sl: ref.current.scrollLeft };
    didDrag.current  = false;
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current || !ref.current) return;
    const dx = startRef.current.x - e.clientX;
    if (Math.abs(dx) > 4) didDrag.current = true;
    ref.current.scrollLeft = startRef.current.sl + dx;
  }, []);
  const onPointerUp = useCallback(() => { startRef.current = null; }, []);
  // Absorb click events that followed a drag so pills don't toggle accidentally
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDrag.current) { e.stopPropagation(); didDrag.current = false; }
  }, []);
  return { ref, onPointerDown, onPointerMove, onPointerUp, onClickCapture };
}

type FilterId    = 'all' | 'favorites' | 'recent';
type SortField   = 'title' | 'artist' | 'album' | 'duration_ms' | 'ingested_at';
type SortDir     = 'asc' | 'desc';
type SortCriterion = { field: SortField; dir: SortDir };

// ── Sort state ─────────────────────────────────────────────────────────────────
// Numeric/date fields default descending; text fields default ascending
const defaultDir = (f: SortField): SortDir => (f === 'ingested_at' || f === 'duration_ms') ? 'desc' : 'asc';

// Sort preferences are persisted so the user's chosen order survives restarts.
const SORT_KEY = 'mm-lib-sort-multi';
const DEFAULT_CRITERIA: SortCriterion[] = [{ field: 'ingested_at', dir: 'desc' }];
function loadCriteria(): SortCriterion[] {
  try {
    const r = localStorage.getItem(SORT_KEY);
    if (r) {
      const parsed = JSON.parse(r);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_CRITERIA;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Seconds since epoch to "X days ago" bucket: 0 = this week, 1 = this month, 2 = older
function ageBucket(ingestedAt: number): 0 | 1 | 2 {
  const diffDays = (Date.now() / 1000 - ingestedAt) / 86400;
  if (diffDays <= 7)  return 0;
  if (diffDays <= 30) return 1;
  return 2;
}

function MMSearchBar({ value, onChange, placeholder = 'Search tracks' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      borderRadius: 14, color: 'var(--text-2)',
    }}>
      <Icons.search size={16} stroke="var(--text-2)"/>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 15, color: value ? 'var(--text-0)' : 'var(--text-2)',
          fontFamily: 'Outfit, sans-serif',
        }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', display: 'flex' }}><Icons.x size={15} stroke="var(--text-2)"/></button>
      )}
    </div>
  );
}

function FilterPill({ label, active, count, onClick }: {
  label: string; active?: boolean; count?: number; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 99,
      background: active ? 'var(--accent)' : 'var(--bg-2)',
      border: active ? '1px solid var(--accent)' : '0.5px solid var(--border-1)',
      color: active ? 'var(--bg-0)' : 'var(--text-1)',
      fontSize: 12.5, fontWeight: 500, letterSpacing: 0.02,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {label}
      {count != null && (
        <span style={{ fontSize: 10.5, opacity: 0.7, fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>
      )}
    </button>
  );
}

const TRACK_H   = 62;
const SECTION_H = 36;

function MMToast({ message }: { message: string }) {
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(var(--tab-h) + 14px)', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-3)', border: '0.5px solid var(--border-2)',
      borderRadius: 20, padding: '8px 18px',
      fontSize: 12, color: 'var(--accent-light, var(--accent))',
      fontFamily: "'JetBrains Mono', monospace",
      boxShadow: '0 4px 20px rgba(0,0,0,0.55)',
      pointerEvents: 'none', zIndex: 200, whiteSpace: 'nowrap',
      animation: 'mmFadeSlide 0.2s ease',
    }}>
      {message}
    </div>
  );
}

function AddToPlaylistSheet({ hashes, onClose, onSuccess }: {
  hashes: string[]; label: string; onClose: () => void; onSuccess: (msg: string) => void;
}) {
  const playlists = useStore(s => s.playlists);
  const [drill, setDrill] = useState<PlaylistRecord | null>(null);
  const [busy,  setBusy]  = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const doAdd = async (playlistId: string, branchName: string, plName: string) => {
    setBusy(true); setErrMsg('');
    try {
      await invoke('branch_append_tracks', { playlistId, branchName, hashes });
      const n = hashes.length;
      onSuccess(`Added ${n === 1 ? '1 track' : `${n} tracks`} → ${plName}`);
      onClose();
    } catch (e) {
      setBusy(false);
      setErrMsg(String(e));
    }
  };

  const handlePlaylist = (pl: PlaylistRecord) => {
    if (pl.branches.length === 1) { doAdd(pl.id, pl.branches[0].name, pl.name); return; }
    setDrill(pl);
  };

  if (drill) return (
    <>
      <button onClick={() => setDrill(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 13, padding: '4px 0 12px' }}>
        <Icons.chevLeft size={14} stroke="var(--text-2)"/> All playlists
      </button>
      {errMsg && <div style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 8 }}>{errMsg}</div>}
      {drill.branches.map(b => (
        <button key={b.id} onClick={() => doAdd(drill.id, b.name, drill.name)} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 0', background: 'none', border: 'none', borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer', color: 'inherit' }}
        >
          <span style={{ fontSize: 13, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>⎇</span>
          <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 500 }}>{b.name}</span>
        </button>
      ))}
    </>
  );

  return (
    <>
      {errMsg && <div style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 8 }}>{errMsg}</div>}
      {playlists.length === 0
        ? <div style={{ color: 'var(--text-3)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>No playlists yet</div>
        : playlists.map(pl => (
          <button key={pl.id} onClick={() => handlePlaylist(pl)} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 0', background: 'none', border: 'none', borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer', color: 'inherit' }}
          >
            <PlaylistArt playlistId={pl.id} branch="main"/>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</div>
              {pl.branches.length > 1 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>{pl.branches.length} branches</div>
              )}
            </div>
            {pl.branches.length > 1 && <Icons.chevRight size={14} stroke="var(--text-3)"/>}
          </button>
        ))
      }
    </>
  );
}

type FlatItem =
  | { kind: 'section'; label: string; trailing?: string }
  | { kind: 'track';   track: TrackRecord; idx: number; playing: boolean };

// ── TrackRow ───────────────────────────────────────────────────────────────────
// Long-press (500 ms) opens the "Add to Playlist" action sheet.
// In select-mode the row becomes a checkbox; long-press is disabled to avoid
// conflicting with the selection tap target.
function TrackRow({ track, idx, playing = false, onLongPress, onFavorite, selected, onSelect }: {
  track: TrackRecord; idx: number; playing?: boolean;
  onLongPress?: () => void; onFavorite?: () => void; selected?: boolean; onSelect?: () => void;
}) {
  // useTrackArtwork reads from the module-level artwork cache (artworkCache.ts)
  // via useSyncExternalStore — no fetch is started here; the cache is pre-populated
  // at startup in MobileApp's init effect.
  const artworkUrl = useTrackArtwork(track.hash, track.artwork_hash);
  const subtext = [track.artist ?? 'Unknown artist', track.album].filter(Boolean).join(' | ');
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLp = () => {
    lpTimer.current = setTimeout(() => { lpTimer.current = null; onLongPress?.(); }, 500);
  };
  const cancelLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const inSelectMode = onSelect !== undefined;
  return (
    <div
      onClick={inSelectMode ? onSelect : undefined}
      onPointerDown={inSelectMode ? undefined : e => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); startLp(); }}
      onPointerUp={inSelectMode ? undefined : cancelLp}
      onPointerCancel={inSelectMode ? undefined : cancelLp}
      onPointerMove={inSelectMode ? undefined : e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelLp(); }}
      style={{
        height: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
        cursor: inSelectMode ? 'pointer' : 'default',
        background: selected ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : playing ? 'oklch(0.62 0.15 28 / 0.08)' : 'transparent',
        borderLeft: playing ? '2px solid var(--accent)' : '2px solid transparent',
      }}>
      {inSelectMode ? (
        <div style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0,
          background: selected ? 'var(--accent)' : 'transparent',
          border: selected ? 'none' : '1.5px solid var(--border-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <Icons.check size={11} stroke="var(--bg-0)"/>}
        </div>
      ) : (
        <span style={{ width: 18, textAlign: 'right', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
          {String(idx).padStart(2, '0')}
        </span>
      )}
      <MMArt src={artworkUrl ?? undefined} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <MarqueeText
            text={track.title}
            active={playing}
            style={{ flex: 1, minWidth: 0 }}
            textStyle={{ fontSize: 14, color: playing ? 'var(--accent)' : 'var(--text-0)', fontWeight: 500 }}
          />
          {!inSelectMode && (
            <button
              onClick={e => { e.stopPropagation(); onFavorite?.(); }}
              onPointerDown={e => e.stopPropagation()}
              style={{ background: 'none', border: 'none', padding: '2px 0 2px 2px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: track.favorited ? 1 : 0.25 }}
            >
              {track.favorited
                ? <Icons.heartFill size={12} stroke="var(--accent)"/>
                : <Icons.heart size={12} stroke="var(--text-2)"/>
              }
            </button>
          )}
        </div>
        <MarqueeText
          text={subtext}
          active={playing}
          style={{ marginTop: 1 }}
          textStyle={{ fontSize: 11.5, color: 'var(--text-2)' }}
        />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
        {fmtDuration(track.duration_ms)}
      </span>
    </div>
  );
}

function SectionHead({ label, trailing }: { label: string; trailing?: string }) {
  return (
    <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</h3>
      {trailing && <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{trailing}</span>}
    </div>
  );
}

// Module-level so both MiniPlayer instances (Library + PlaylistsList tabs) share the same flag;
// if it were per-instance state, dismissing on one tab would silently restore on the other.
let _miniPlayerDismissed = localStorage.getItem('mm_miniplayer_dismissed') === '1';

export function MiniPlayer({ onTab, bottomOffset = 0 }: { onTab?: (id: TabId) => void; bottomOffset?: number }) {
  const loadedTrackHash = useStore(s => s.loadedTrackHash);
  const isPlaying       = useStore(s => s.isPlaying);
  const duration_ms     = useStore(s => s.duration_ms);
  const setPlaying      = useStore(s => s.setPlaying);
  const tracks          = useStore(s => s.tracks);
  const advance         = useStore(s => s.advance);

  const currentTrack = tracks.find(t => t.hash === loadedTrackHash) ?? null;
  const artUrl = useTrackArtwork(loadedTrackHash ?? '', currentTrack?.artwork_hash ?? null);

  const [dismissed, setDismissedRaw] = useState(_miniPlayerDismissed);
  const startXRef      = useRef<number | null>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const prevHashRef    = useRef(loadedTrackHash);
  const dismissTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRestoredRef = useRef(false);

  const setDismissed = (v: boolean) => {
    _miniPlayerDismissed = v;
    if (v) localStorage.setItem('mm_miniplayer_dismissed', '1');
    else   localStorage.removeItem('mm_miniplayer_dismissed');
    setDismissedRaw(v);
  };

  // Restore whenever a genuinely new track starts — but not on initial mount.
  useEffect(() => {
    if (loadedTrackHash === prevHashRef.current) return;
    prevHashRef.current = loadedTrackHash;
    if (loadedTrackHash) setDismissed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTrackHash]);

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); }, []);

  const progressFillRef = useRef<HTMLDivElement>(null);
  const durRef = useRef(duration_ms);
  useEffect(() => { durRef.current = duration_ms; }, [duration_ms]);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const dur = durRef.current;
      if (progressFillRef.current) {
        progressFillRef.current.style.width =
          dur > 0 ? `${Math.min(positionMsRef.current / dur, 1) * 100}%` : '0%';
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loadedTrackHash) return null;

  // Dismissed: plain button — no pointer capture, no event bleed to the full player on restore.
  if (dismissed) {
    return (
      <button
        onClick={() => {
          if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
          wasRestoredRef.current = true;
          setDismissed(false);
        }}
        style={{
          position: 'absolute', left: 12, bottom: `calc(var(--tab-h) + ${4 + bottomOffset}px)`, zIndex: 25,
          width: 44, height: 44, borderRadius: 22,
          background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          animation: 'mmFadeSlide 0.2s ease both',
        }}
      >
        <Icons.chevRight size={20} stroke="var(--accent)"/>
      </button>
    );
  }

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      invoke('audio_pause').catch(console.error);
      setPlaying(false);
    } else {
      invoke('audio_play').catch(console.error);
      setPlaying(true);
    }
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    advance();
    const s = useStore.getState();
    const hash = s.currentHash();
    if (!hash) return;
    const track = s.tracks.find(t => t.hash === hash);
    if (!track) return;
    s.setLoaded(track.hash, track.duration_ms);
    positionMsRef.current = 0;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    s.setPlaying(true);
  };

  // Slide fully off-screen then flip to dismissed.
  const dismiss = () => {
    startXRef.current = null;
    _miniPlayerDismissed = true; // update shared state immediately
    localStorage.setItem('mm_miniplayer_dismissed', '1');
    const el = containerRef.current;
    if (!el) { setDismissedRaw(true); return; }
    el.style.transition = 'transform 0.22s ease-in, opacity 0.22s ease-in';
    el.style.transform = `translateX(${-(el.offsetWidth + 24)}px)`;
    el.style.opacity = '0';
    dismissTimer.current = setTimeout(() => { dismissTimer.current = null; setDismissedRaw(true); }, 230);
  };

  const snapBack = () => {
    startXRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.25s ease-out';
    el.style.transform = 'translateX(0px)';
    el.style.opacity = '1';
  };

  // Buttons excluded from drag tracking so their click events still fire normally.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (containerRef.current) containerRef.current.style.transition = 'none';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    if (dx >= 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(Math.max(0, 1 + dx / (el.offsetWidth * 0.6)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    startXRef.current = null;
    const containerW = containerRef.current?.offsetWidth ?? 320;
    if (dx < -(containerW * 0.25)) { dismiss(); }
    else { snapBack(); }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', left: 12, right: 12, bottom: `calc(var(--tab-h) + ${4 + bottomOffset}px)`, zIndex: 25,
        height: 62, borderRadius: 16, padding: '8px 10px',
        background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
        boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden',
        cursor: 'pointer',
        transition: 'bottom 0.2s ease',
        touchAction: 'pan-y',
        ...(wasRestoredRef.current ? { animation: 'mmMiniPlayerIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both' } : {}),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={snapBack}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: 'var(--bg-3)' }}>
        <div ref={progressFillRef} style={{ height: '100%', width: '0%', background: 'linear-gradient(90deg, var(--accent), var(--accent-light))' }}/>
      </div>
      <MMArt src={artUrl ?? undefined} size={44} radius={9}/>
      <div style={{ flex: 1, minWidth: 0 }} onClick={() => onTab?.('now')}>
        <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.title ?? ''}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack?.artist ?? ''}</div>
      </div>
      <button onClick={handlePlayPause} style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--bg-3)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-0)', flexShrink: 0 }}>
        {isPlaying ? <Icons.pause size={17}/> : <Icons.play size={17}/>}
      </button>
      <button onClick={handleNext} style={{ width: 34, height: 34, borderRadius: 17, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-1)', flexShrink: 0 }}>
        <Icons.next size={18} stroke="var(--text-1)"/>
      </button>
    </div>
  );
}

const SECTION_LABELS = ['This week', 'This month', 'Older'] as const;

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'ingested_at', label: 'Date Added' },
  { field: 'title',       label: 'Title' },
  { field: 'artist',      label: 'Artist' },
  { field: 'album',       label: 'Album' },
  { field: 'duration_ms', label: 'Duration' },
];

export function Library({ onTab }: { onTab: (id: TabId) => void; onPlaylistDetail?: () => void }) {
  const tracks          = useStore(s => s.tracks);
  const libraryStatus   = useStore(s => s.libraryStatus);
  const loadedTrackHash = useStore(s => s.loadedTrackHash);
  const toggleFavorite  = useStore(s => s.toggleFavorite);
  const [filter,         setFilter]         = useState<FilterId>('all');
  const [query,          setQuery]          = useState('');
  const [sortCriteria,   setSortCriteria]   = useState<SortCriterion[]>(loadCriteria);
  const [actionSheet,    setActionSheet]    = useState<{ hashes: string[]; label: string } | null>(null);
  const [selectMode,     setSelectMode]     = useState(false);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [toast,          setToast]          = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef      = useRef<HTMLDivElement>(null);
  const filterScroll = useHorizDragScroll();
  const sortScroll   = useHorizDragScroll();
  const loadLibrary  = useStore(s => s.loadLibrary);
  const { scrollRef: ptrRef, pullY, refreshing } = usePullToRefresh(useCallback(() => loadLibrary(), [loadLibrary]));

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedHashes(new Set());
  }, []);

  const toggleSelect = useCallback((hash: string) => {
    setSelectedHashes(prev => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  }, []);

  useEffect(() => {
    if (sortCriteria.length > 0) localStorage.setItem(SORT_KEY, JSON.stringify(sortCriteria));
    else localStorage.removeItem(SORT_KEY);
  }, [sortCriteria]);

  // Three-state cycle per field: inactive → defaultDir → opposite → removed
  const handleSort = (field: SortField) => {
    setSortCriteria(prev => {
      const idx = prev.findIndex(c => c.field === field);
      if (idx === -1) return [...prev, { field, dir: defaultDir(field) }];
      const cur = prev[idx];
      // On second tap (opposite of default) → remove; otherwise → toggle direction
      if (cur.dir !== defaultDir(field)) return prev.filter((_, i) => i !== idx);
      const next = [...prev];
      next[idx] = { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return next;
    });
  };

  const favCount = useMemo(() => tracks.filter(t => t.favorited).length, [tracks]);

  const displayed = useMemo<TrackRecord[]>(() => {
    let list = tracks;
    if (filter === 'favorites') list = list.filter(t => t.favorited);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.artist ?? '').toLowerCase().includes(q) ||
        (t.album ?? '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      for (const { field, dir } of sortCriteria) {
        const av = a[field] ?? '', bv = b[field] ?? '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [tracks, filter, query, sortCriteria]);

  // Date grouping only applies when primary sort is date added; suppressed for search
  // results and favorites filter since those have their own section headers.
  const grouped = useMemo(() => {
    if (query.trim() || filter === 'favorites' || sortCriteria[0]?.field !== 'ingested_at') return null;
    const groups: [typeof SECTION_LABELS[number], TrackRecord[]][] = [
      ['This week', []], ['This month', []], ['Older', []],
    ];
    displayed.forEach(t => groups[ageBucket(t.ingested_at)][1].push(t));
    return groups.filter(([, ts]) => ts.length > 0);
  }, [displayed, query, filter, sortCriteria]);

  // ── Virtualization ─────────────────────────────────────────────────────────
  // flatItems merges section headers and track rows into a single array so
  // @tanstack/react-virtual can handle them with a uniform index space.
  // Without virtualization a 5000-track library would render ~5000 DOM nodes.
  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    let rowIdx = 0;
    if (query.trim() && displayed.length > 0) {
      items.push({ kind: 'section', label: `${displayed.length} result${displayed.length !== 1 ? 's' : ''}` });
    }
    if (grouped) {
      grouped.forEach(([label, sectionTracks]) => {
        items.push({ kind: 'section', label, trailing: String(sectionTracks.length) });
        sectionTracks.forEach(t => items.push({ kind: 'track', track: t, idx: ++rowIdx, playing: t.hash === loadedTrackHash }));
      });
    } else {
      displayed.forEach(t => items.push({ kind: 'track', track: t, idx: ++rowIdx, playing: t.hash === loadedTrackHash }));
    }
    return items;
  }, [displayed, grouped, query, loadedTrackHash]);

  // overscan=6 keeps 6 extra rows rendered above/below the visible window to
  // absorb fast flings without momentary blank rows.
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: i => flatItems[i]?.kind === 'section' ? SECTION_H : TRACK_H,
    overscan: 6,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 'calc(16px + var(--safe-top))' }}>

      {/* Fixed header — title, search, filter pills */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.5 }}>Library</h1>
          {selectMode ? (
            <button onClick={exitSelectMode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 15, fontWeight: 500, paddingBottom: 6 }}>
              Cancel
            </button>
          ) : (
            <button onClick={() => setSelectMode(true)} style={{ ...iconBtn(32), color: 'var(--text-1)', marginBottom: 2 }}>
              <Icons.plus size={20} stroke="var(--text-1)"/>
            </button>
          )}
        </div>
        <div style={{ padding: '4px 22px 0', fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
          {libraryStatus === 'loading'
            ? <><span style={{ fontSize: 18, color: 'var(--accent)', display: 'inline-block', animation: 'mmNoteDance 0.9s ease-in-out infinite', transformOrigin: 'bottom center' }}>♪</span><span>Loading…</span></>
            : `${tracks.length} tracks`}
        </div>
        <div style={{ padding: '14px 22px 8px' }}>
          <MMSearchBar value={query} onChange={setQuery}/>
        </div>
        <div ref={filterScroll.ref} onPointerDown={filterScroll.onPointerDown} onPointerMove={filterScroll.onPointerMove} onPointerUp={filterScroll.onPointerUp} onClickCapture={filterScroll.onClickCapture} style={{ display: 'flex', gap: 8, overflowX: 'auto', touchAction: 'pan-x', padding: '8px 0 6px', cursor: 'grab' }} className="mm-scroll">
          <div style={{ width: 22, flexShrink: 0 }}/>
          <FilterPill label="All"            active={filter === 'all'}       count={tracks.length}         onClick={() => setFilter('all')}/>
          <FilterPill label="Favorites"      active={filter === 'favorites'} count={favCount || undefined} onClick={() => setFilter('favorites')}/>
          <FilterPill label="Recently Added" active={filter === 'recent'}                                  onClick={() => setFilter('recent')}/>
          <div style={{ width: 22, flexShrink: 0 }}/>
        </div>
        {/* Sort pills — multi-select, tap cycles: add → toggle → remove */}
        <div ref={sortScroll.ref} onPointerDown={sortScroll.onPointerDown} onPointerMove={sortScroll.onPointerMove} onPointerUp={sortScroll.onPointerUp} onClickCapture={sortScroll.onClickCapture} style={{ display: 'flex', gap: 6, overflowX: 'auto', touchAction: 'pan-x', padding: '2px 0 10px', cursor: 'grab' }} className="mm-scroll">
          <div style={{ width: 22, flexShrink: 0 }}/>
          {SORT_FIELDS.map(({ field, label }) => {
            const idx    = sortCriteria.findIndex(c => c.field === field);
            const active = idx !== -1;
            const dir    = active ? sortCriteria[idx].dir : null;
            const arrow  = dir === 'asc' ? ' ↑' : dir === 'desc' ? ' ↓' : '';
            const badge  = active && sortCriteria.length > 1 ? idx + 1 : null;
            return (
              <button
                key={field}
                onClick={() => handleSort(field)}
                style={{
                  padding: '4px 11px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0,
                  background: active ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--bg-2)',
                  border: active ? '1px solid var(--accent)55' : '0.5px solid var(--border-1)',
                  color: active ? 'var(--accent)' : 'var(--text-2)',
                  fontSize: 11.5, fontWeight: active ? 600 : 400,
                  fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}
              >
                {badge !== null && (
                  <span style={{ fontSize: 9, opacity: 0.7, lineHeight: 1 }}>{badge}</span>
                )}
                {label}{arrow}
              </button>
            );
          })}
          <div style={{ width: 22, flexShrink: 0 }}/>
        </div>
      </div>

      {/* Virtualized track list */}
      <div ref={el => { (listRef as React.MutableRefObject<HTMLDivElement | null>).current = el; (ptrRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', paddingBottom: selectMode ? 'calc(56px + var(--tab-h))' : 'var(--tab-h)' }} className="mm-scroll">
        <PullSpinner pullY={pullY} refreshing={refreshing}/>
        {libraryStatus === 'ready' && flatItems.length === 0 ? (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            {query ? 'No tracks match your search.' : 'No tracks in library.'}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vItem => {
              const item = flatItems[vItem.index];
              if (!item) return null;
              return (
                <div key={vItem.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vItem.start}px)`, height: vItem.size }}>
                  {item.kind === 'section'
                    ? <SectionHead label={item.label} trailing={item.trailing}/>
                    : <TrackRow
                        track={item.track} idx={item.idx} playing={item.playing}
                        onLongPress={selectMode ? undefined : () => setActionSheet({ hashes: [item.track.hash], label: item.track.title })}
                        onFavorite={() => toggleFavorite(item.track.hash)}
                        selected={selectMode ? selectedHashes.has(item.track.hash) : undefined}
                        onSelect={selectMode ? () => toggleSelect(item.track.hash) : undefined}
                      />
                  }
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating select-mode action bar */}
      {selectMode && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'var(--tab-h)', height: 56, zIndex: 20, background: 'var(--bg-2)', borderTop: '0.5px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px' }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
            {selectedHashes.size > 0 ? `${selectedHashes.size} selected` : 'Tap tracks to select'}
          </span>
          {selectedHashes.size > 0 && (
            <button
              onClick={() => setActionSheet({ hashes: [...selectedHashes], label: `${selectedHashes.size} track${selectedHashes.size !== 1 ? 's' : ''}` })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', border: 'none', borderRadius: 20, padding: '7px 14px', cursor: 'pointer', color: 'var(--bg-0)', fontSize: 13, fontWeight: 600 }}
            >
              Add to Playlist <Icons.chevRight size={13} stroke="var(--bg-0)"/>
            </button>
          )}
        </div>
      )}

      <MiniPlayer onTab={onTab} bottomOffset={selectMode ? 56 : 0}/>
      <MMTabBar active="library" onTab={onTab}/>

      {toast && <MMToast message={toast}/>}

      {actionSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setActionSheet(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title="Add to Playlist"
            subtitle={actionSheet.label}
            height="62%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setActionSheet(null)}
          >
            <AddToPlaylistSheet
              hashes={actionSheet.hashes}
              label={actionSheet.label}
              onClose={() => setActionSheet(null)}
              onSuccess={msg => { setActionSheet(null); showToast(msg); exitSelectMode(); }}
            />
          </MMSheet>
        </div>
      )}
    </div>
  );
}

// ── PlaylistsList ──────────────────────────────────────────────────────────────
function PlaylistArt({ playlistId, branch }: { playlistId: string; branch: string }) {
  const url = usePlaylistArtwork(playlistId, branch);
  return <MMArt src={url ?? undefined} size={54} radius={9}/>;
}

function PlaylistCard({ name, desc, branch, commit, branches, playlistId, pinned, pull, uncommitted, indent, hasConflict, onPress, onConflict }: {
  name: string; desc: string; branch: string; commit: string;
  branches: number; playlistId: string; pinned?: boolean; pull?: boolean;
  uncommitted?: boolean; indent?: boolean; hasConflict?: boolean;
  onPress?: () => void; onConflict?: () => void;
}) {
  return (
    <div onClick={onPress} style={{
      margin: `4px ${indent ? '36px' : '16px'} 4px ${indent ? '36px' : '16px'}`,
      padding: '10px 12px',
      background: 'var(--bg-2)', border: `0.5px solid ${hasConflict ? 'var(--yellow, #f59e0b)' : 'var(--border-1)'}`,
      borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
      cursor: 'pointer',
    }}>
      <PlaylistArt playlistId={playlistId} branch={branch}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {pinned && <span style={{ color: 'var(--accent)', fontSize: 10 }}>●</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <MMBranchPill branch={branch}/>
          <MMHash>{commit}</MMHash>
          {branches > 1 && <MMHash color="var(--text-3)">+{branches - 1}</MMHash>}
          {uncommitted && <span style={{ fontSize: 10.5, color: 'var(--accent-light)', fontFamily: 'JetBrains Mono, monospace' }}>● changes</span>}
          {pull && <span style={{ fontSize: 10.5, color: 'var(--blue)', fontFamily: 'JetBrains Mono, monospace' }}>↓ pull</span>}
          {hasConflict && (
            <span
              onClick={e => { e.stopPropagation(); onConflict?.() }}
              style={{ fontSize: 10.5, color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer' }}
            >
              ⚠️ merge conflict
            </span>
          )}
        </div>
      </div>
      <Icons.chevRight size={14} stroke="var(--text-3)"/>
    </div>
  );
}

function SectionHeadPlain({ label, trailing, collapsible }: { label: string; trailing?: string; collapsible?: boolean }) {
  return (
    <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {collapsible && <Icons.chevDown size={12} stroke="var(--text-2)"/>}
        <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</h3>
      </div>
      {trailing && <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{trailing}</span>}
    </div>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// SVG arc progress ring. r=radius, pct=0..1, stroke width is fixed at 2.5px.
function ProgressRing({ pct, size = 22, color = 'var(--accent)' }: { pct: number; size?: number; color?: string }) {
  const r = (size - 3) / 2
  const circ = 2 * Math.PI * r
  const dash = pct * circ
  return (
    <svg width={size} height={size} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border-2)" strokeWidth={2.5}/>
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={2.5}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.2s ease' }}
      />
    </svg>
  )
}

// Branch selection sheet shown before downloading a peer playlist.
function BranchSelectSheet({ manifest, onConfirm, onCancel }: {
  manifest: import('../../store/types').PlaylistManifest
  onConfirm: (branches: string[]) => void
  onCancel: () => void
}) {
  const branchInfos = manifest.branches.length > 0
    ? manifest.branches
    : [{ name: 'main', track_count: manifest.track_count, size_bytes: manifest.size_bytes, track_hashes: [] }]

  const branchNames = branchInfos.map(b => b.name)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(['main'].filter(n => branchNames.includes(n)).concat(branchInfos.length === 1 ? branchNames : []))
  )

  const toggle = (name: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(name)) {
      if (next.size === 1) return prev
      next.delete(name)
    } else {
      next.add(name)
    }
    return next
  })

  // Unique track count + total size across selected branches.
  const { uniqueTracks, totalBytes } = useMemo(() => {
    const uniqueHashes = new Set<string>()
    let bytes = 0
    let noHashCount = 0
    for (const b of branchInfos) {
      if (!selected.has(b.name)) continue
      bytes += b.size_bytes
      if (b.track_hashes.length > 0) {
        b.track_hashes.forEach(h => uniqueHashes.add(h))
      } else {
        noHashCount += b.track_count
      }
    }
    return {
      uniqueTracks: uniqueHashes.size > 0 ? uniqueHashes.size : noHashCount,
      totalBytes: bytes,
    }
  }, [selected, branchInfos])

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 6 }}>
          Choose branches to download from <span style={{ color: 'var(--accent)' }}>{manifest.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-3)', borderRadius: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
            {selected.size > 0 ? (
              <>{uniqueTracks} unique track{uniqueTracks !== 1 ? 's' : ''} · <span style={{ color: 'var(--accent-light, var(--accent))' }}>{fmtBytes(totalBytes)}</span></>
            ) : 'Select at least one branch'}
          </span>
        </div>
      </div>
      {branchInfos.map(b => (
        <button
          key={b.name}
          onClick={() => toggle(b.name)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: '10px 0', background: 'none', border: 'none',
            borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer', color: 'inherit',
          }}
        >
          <div style={{
            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
            background: selected.has(b.name) ? 'var(--accent)' : 'transparent',
            border: selected.has(b.name) ? 'none' : '1.5px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {selected.has(b.name) && <Icons.check size={12} stroke="var(--bg-0)"/>}
          </div>
          <span style={{ fontSize: 13.5, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>⎇</span>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 15, color: 'var(--text-0)', fontWeight: 500 }}>{b.name}</span>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtBytes(b.size_bytes)}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
              {b.track_count} track{b.track_count !== 1 ? 's' : ''}
              {b.name === 'main' ? ' · primary' : ''}
            </div>
          </div>
        </button>
      ))}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: '11px 0', borderRadius: 12, background: 'var(--bg-3)', border: 'none', cursor: 'pointer', color: 'var(--text-1)', fontSize: 14, fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm([...selected])}
          disabled={selected.size === 0}
          style={{ flex: 2, padding: '11px 0', borderRadius: 12, background: 'var(--accent)', border: 'none', cursor: 'pointer', color: 'var(--bg-0)', fontSize: 14, fontWeight: 600 }}
        >
          {selected.size > 1 ? `Download ${selected.size} branches` : 'Download'}
        </button>
      </div>
    </>
  )
}

// Tapping a playlist card sets it as the current playlist and opens the detail
// overlay (PlaylistDetail) — the detail component reads currentPlaylistId from
// the store rather than receiving it as a prop.
function PeerPlaylistCard({ manifest, peerAddr, peerName, isDownloading, isLocal, progress, onRequestDownload }: {
  manifest: import('../../store/types').PlaylistManifest
  peerAddr: string
  peerName: string
  isDownloading: boolean
  isLocal: boolean
  progress: number  // 0..1, only meaningful when isDownloading
  onRequestDownload: (branches: string[]) => void
}) {
  const [showSheet, setShowSheet] = useState(false)

  const handleTap = () => {
    if (isDownloading) return
    const branchNames = manifest.branches.length > 0 ? manifest.branches.map(b => b.name) : ['main']
    if (branchNames.length === 1) {
      onRequestDownload(branchNames)
    } else {
      setShowSheet(true)
    }
  }

  return (
    <>
      <div
        onClick={handleTap}
        style={{
          margin: '4px 16px',
          padding: '10px 12px',
          background: isLocal ? 'var(--bg-2)' : 'color-mix(in srgb, var(--bg-2) 60%, transparent)',
          border: isLocal ? '0.5px solid var(--border-1)' : '0.5px dashed var(--border-2)',
          borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
          cursor: isDownloading ? 'default' : 'pointer',
          opacity: isLocal ? 1 : 0.8,
        }}
      >
        {manifest.artwork_hash ? (
          <img
            src={`http://${peerAddr}/blob/${manifest.artwork_hash}`}
            style={{ width: 54, height: 54, borderRadius: 9, objectFit: 'cover', flexShrink: 0, opacity: isLocal ? 1 : 0.65 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <MMArt size={54} radius={9}/>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {manifest.name}
          </span>
          {manifest.description && (
            <span style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'block', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {manifest.description}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
              from {peerName}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
              {manifest.track_count} track{manifest.track_count !== 1 ? 's' : ''}
            </span>
            {isDownloading && (
              <span style={{ fontSize: 10.5, color: 'var(--accent-light, var(--accent))', fontFamily: 'JetBrains Mono, monospace' }}>
                syncing · {fmtBytes(manifest.size_bytes)}
              </span>
            )}
            {isLocal && !isDownloading && (
              <span style={{ fontSize: 10.5, color: 'var(--green, #4ade80)', fontFamily: 'JetBrains Mono, monospace' }}>✓ synced</span>
            )}
            {!isLocal && !isDownloading && manifest.branches.length > 1 && (
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                {manifest.branches.length} branches
              </span>
            )}
          </div>
        </div>
        {isDownloading
          ? <ProgressRing pct={progress} size={22}/>
          : isLocal
            ? <Icons.sync size={16} stroke="var(--text-3)"/>
            : <Icons.download size={17} stroke="var(--text-2)"/>
        }
      </div>

      {showSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
          <div onClick={() => setShowSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title={isLocal ? 'Sync Branches' : 'Download Branches'}
            height="56%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setShowSheet(false)}
          >
            <BranchSelectSheet
              manifest={manifest}
              onConfirm={branches => { setShowSheet(false); onRequestDownload(branches) }}
              onCancel={() => setShowSheet(false)}
            />
          </MMSheet>
        </div>
      )}
    </>
  )
}

export function PlaylistsList({ onTab, onPlaylistDetail }: { onTab: (id: TabId) => void; onPlaylistDetail: () => void }) {
  const playlists            = useStore(s => s.playlists);
  const setCurrentPlaylist   = useStore(s => s.setCurrentPlaylist);
  const branchByPlaylist     = useStore(s => s.branchByPlaylist);
  const peerManifest         = useStore(s => s.peerManifest);
  const peerManifestPeer     = useStore(s => s.peerManifestPeer);
  const peerManifestLoading  = useStore(s => s.peerManifestLoading);
  const downloadingPlaylists = useStore(s => s.downloadingPlaylists);
  const downloadPlaylist     = useStore(s => s.downloadPlaylist);
  const downloadProgress     = useStore(s => s.downloadProgress);
  const livePeers               = useStore(s => s.livePeers);
  const knownDevices            = useStore(s => s.knownDevices);
  const openPeerManifest        = useStore(s => s.openPeerManifest);
  const pendingConflictPlaylists = useStore(s => s.pendingConflictPlaylists);
  const reopenConflict          = useStore(s => s.reopenConflict);
  const [query, setQuery]       = useState('');

  // Auto-fetch the manifest from the first trusted live peer so ghost cards
  // appear without the user having to navigate to Settings first.
  useEffect(() => {
    if (livePeers.length === 0) return;
    const trusted = livePeers.find(p => knownDevices.some(k => k.public_key_b64 === p.public_key_b64));
    if (!trusted) return;
    if (peerManifestPeer?.public_key_b64 === trusted.public_key_b64 && peerManifest !== null) return;
    openPeerManifest(trusted);
  }, [livePeers, knownDevices]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlaylists    = useStore(s => s.loadPlaylists);
  const refreshLivePeers = useStore(s => s.refreshLivePeers);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadPlaylists(), refreshLivePeers()]);
    // Re-fetch peer manifest for the current or newly discovered trusted peer
    const allPeers = useStore.getState().livePeers;
    const allKnown = useStore.getState().knownDevices;
    const trusted  = allPeers.find(p => allKnown.some(k => k.public_key_b64 === p.public_key_b64));
    if (trusted) openPeerManifest(trusted);
  }, [loadPlaylists, refreshLivePeers, openPeerManifest]);

  const { scrollRef, pullY, refreshing } = usePullToRefresh(handleRefresh);

  const localIds = useMemo(() => new Set(playlists.map(p => p.id)), [playlists]);
  const peerAddr = peerManifestPeer?.addr ?? '';
  const peerName = peerManifestPeer?.display_name ?? 'Peer';

  // Peer playlists that aren't already local (ghost cards) + already-synced ones
  const peerPlaylists = peerManifest ?? [];

  const displayed = useMemo(() => {
    if (!query.trim()) return playlists;
    const q = query.toLowerCase();
    return playlists.filter(p => p.name.toLowerCase().includes(q));
  }, [playlists, query]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div ref={scrollRef} style={{ position: 'absolute', inset: 'calc(16px + var(--safe-top)) 0 var(--tab-h)', overflowY: 'auto' }} className="mm-scroll">
        <PullSpinner pullY={pullY} refreshing={refreshing}/>
        <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.5 }}>Playlists</h1>
          <button style={iconBtn(36)}><Icons.plus size={20} stroke="var(--accent)"/></button>
        </div>
        <div style={{ padding: '4px 22px 12px', fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
          {playlists.length} playlist{playlists.length !== 1 ? 's' : ''}
          {playlists.length > 0 && ` · ${playlists.reduce((n, p) => n + p.branches.length, 0)} branches`}
        </div>

        <div style={{ padding: '4px 22px 8px' }}>
          <MMSearchBar value={query} onChange={setQuery} placeholder="Search playlists"/>
        </div>

        {/* Local playlists */}
        {displayed.length === 0 && peerPlaylists.length === 0 ? (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            {query ? 'No playlists match.' : 'No playlists yet.'}
          </div>
        ) : displayed.length > 0 && (
          <>
            <SectionHeadPlain label="My playlists" trailing={String(displayed.length)}/>
            {displayed.map(p => {
              const selectedBranchName = branchByPlaylist[p.id] ?? 'main';
              const activeBranch = p.branches.find(b => b.name === selectedBranchName) ?? p.branches.find(b => b.name === 'main') ?? p.branches[0];
              const commit = activeBranch?.head_commit?.slice(0, 6) ?? '—';
              return (
                <PlaylistCard
                  key={p.id}
                  playlistId={p.id}
                  name={p.name}
                  desc={p.description ? p.description : `${p.branches.length} branch${p.branches.length !== 1 ? 'es' : ''}`}
                  branch={activeBranch?.name ?? selectedBranchName}
                  commit={commit}
                  branches={p.branches.length}
                  hasConflict={pendingConflictPlaylists.includes(p.id)}
                  onPress={() => { setCurrentPlaylist(p.id); onPlaylistDetail(); }}
                  onConflict={() => reopenConflict(p.id)}
                />
              );
            })}
          </>
        )}

        {/* Peer playlists */}
        {peerManifestLoading && (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ width: 20, height: 20, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'mmSpin 0.7s linear infinite', margin: '0 auto' }}/>
          </div>
        )}
        {peerPlaylists.length > 0 && (
          <>
            <SectionHeadPlain label={`From ${peerName}`} trailing={String(peerPlaylists.length)}/>
            {peerPlaylists.map(manifest => (
              <PeerPlaylistCard
                key={manifest.id}
                manifest={manifest}
                peerAddr={peerAddr}
                peerName={peerName}
                isLocal={localIds.has(manifest.id)}
                isDownloading={downloadingPlaylists.includes(manifest.id)}
                progress={downloadProgress[manifest.id] ?? 0}
                onRequestDownload={branches => downloadPlaylist(manifest.id, branches)}
              />
            ))}
          </>
        )}

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="playlists" onTab={onTab}/>
    </div>
  );
}
