import React, { useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { TrackRecord } from '../../store/types';
import { Icons } from '../icons';
import { MMArt, MMTabBar, MMHash, MMBranchPill, iconBtn } from './common';
import type { TabId } from './common';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef } from '../playerContext';

type FilterId = 'all' | 'favorites' | 'recent';

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
      {value
        ? <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', display: 'flex' }}><Icons.x size={15} stroke="var(--text-2)"/></button>
        : <Icons.filter size={16} stroke="var(--text-2)"/>
      }
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

function TrackRow({ track, idx, playing = false }: {
  track: TrackRecord; idx: number; playing?: boolean;
}) {
  const artworkUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
      background: playing ? 'oklch(0.62 0.15 28 / 0.08)' : 'transparent',
      borderLeft: playing ? '2px solid var(--accent)' : '2px solid transparent',
    }}>
      <span style={{ width: 18, textAlign: 'right', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
        {String(idx).padStart(2, '0')}
      </span>
      <MMArt src={artworkUrl ?? undefined} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {track.title}
          </span>
          {track.favorited && <Icons.heartFill size={11} stroke="var(--accent)"/>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.artist ?? 'Unknown artist'}{track.album ? ` · ${track.album}` : ''}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
        {fmtDuration(track.duration_ms)}
      </span>
      <Icons.moreV size={16} stroke="var(--text-3)"/>
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

export function MiniPlayer({ onTab }: { onTab?: (id: TabId) => void }) {
  const loadedTrackHash = useStore(s => s.loadedTrackHash);
  const isPlaying       = useStore(s => s.isPlaying);
  const duration_ms     = useStore(s => s.duration_ms);
  const setPlaying      = useStore(s => s.setPlaying);
  const tracks          = useStore(s => s.tracks);
  const advance         = useStore(s => s.advance);

  const currentTrack = tracks.find(t => t.hash === loadedTrackHash) ?? null;
  const artUrl = useTrackArtwork(loadedTrackHash ?? '', currentTrack?.artwork_hash ?? null);

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

  const containerStyle: React.CSSProperties = {
    position: 'absolute', left: 12, right: 12, bottom: 90, zIndex: 25,
    height: 62, borderRadius: 16, padding: '8px 10px',
    background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
    boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden',
    cursor: currentTrack ? 'pointer' : 'default',
  };

  return (
    <div style={containerStyle} onClick={currentTrack ? () => onTab?.('now') : undefined}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: 'var(--bg-3)' }}>
        <div ref={progressFillRef} style={{ height: '100%', width: '0%', background: 'linear-gradient(90deg, var(--accent), var(--accent-light))' }}/>
      </div>
      <MMArt src={artUrl ?? undefined} size={44} radius={9}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        {currentTrack ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.artist}</div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic' }}>Nothing playing</div>
        )}
      </div>
      {currentTrack && (
        <>
          <button onClick={handlePlayPause} style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--bg-3)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-0)', flexShrink: 0 }}>
            {isPlaying ? <Icons.pause size={17}/> : <Icons.play size={17}/>}
          </button>
          <button onClick={handleNext} style={{ width: 36, height: 36, borderRadius: 18, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-1)', flexShrink: 0 }}>
            <Icons.next size={19} stroke="var(--text-1)"/>
          </button>
        </>
      )}
    </div>
  );
}

const SECTION_LABELS = ['This week', 'This month', 'Older'] as const;

export function Library({ onTab }: { onTab: (id: TabId) => void; onPlaylistDetail?: () => void }) {
  const tracks = useStore(s => s.tracks);
  const libraryStatus = useStore(s => s.libraryStatus);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');

  const favCount = useMemo(() => tracks.filter(t => t.favorited).length, [tracks]);

  // Filtered + sorted track list
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
    // Most recently added first
    return [...list].sort((a, b) => b.ingested_at - a.ingested_at);
  }, [tracks, filter, query]);

  // Grouped by recency (only when not searching and not in Favorites filter)
  const grouped = useMemo(() => {
    if (query.trim() || filter === 'favorites') return null;
    const groups: [typeof SECTION_LABELS[number], TrackRecord[]][] = [
      ['This week', []],
      ['This month', []],
      ['Older', []],
    ];
    displayed.forEach(t => groups[ageBucket(t.ingested_at)][1].push(t));
    return groups.filter(([, tracks]) => tracks.length > 0);
  }, [displayed, query, filter]);

  const subtitle = libraryStatus === 'loading'
    ? 'Loading…'
    : `${tracks.length} tracks`;

  // Running index for row numbering
  let rowIdx = 0;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.5 }}>Library</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={iconBtn(32)}><Icons.download size={18} stroke="var(--text-1)"/></button>
            <button style={iconBtn(32)}><Icons.more size={18} stroke="var(--text-1)"/></button>
          </div>
        </div>
        <div style={{ padding: '4px 22px 0', fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
          {subtitle}
        </div>

        <div style={{ padding: '14px 22px 8px' }}>
          <MMSearchBar value={query} onChange={setQuery}/>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '8px 22px 14px', overflowX: 'auto' }} className="mm-scroll">
          <FilterPill label="All"            active={filter === 'all'}       count={tracks.length}  onClick={() => setFilter('all')}/>
          <FilterPill label="Favorites"      active={filter === 'favorites'} count={favCount || undefined} onClick={() => setFilter('favorites')}/>
          <FilterPill label="Recently Added" active={filter === 'recent'}    onClick={() => setFilter('recent')}/>
        </div>

        {/* Track list */}
        {query.trim() && (
          <SectionHead label={`${displayed.length} result${displayed.length !== 1 ? 's' : ''}`}/>
        )}

        {grouped
          ? grouped.map(([label, sectionTracks]) => (
              <div key={label}>
                <SectionHead label={label} trailing={`${sectionTracks.length}`}/>
                {sectionTracks.map(t => (
                  <TrackRow key={t.hash} track={t} idx={++rowIdx} playing={false}/>
                ))}
              </div>
            ))
          : displayed.map(t => (
              <TrackRow key={t.hash} track={t} idx={++rowIdx} playing={false}/>
            ))
        }

        {libraryStatus === 'ready' && displayed.length === 0 && (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            {query ? 'No tracks match your search.' : 'No tracks in library.'}
          </div>
        )}

        <div style={{ height: 12 }}/>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="library" onTab={onTab}/>
    </div>
  );
}

// ── PlaylistsList — still mock data until Phase 2
function PlaylistArt({ playlistId }: { playlistId: string }) {
  const url = usePlaylistArtwork(playlistId);
  return <MMArt src={url ?? undefined} size={54} radius={9}/>;
}

function PlaylistCard({ name, desc, branch, commit, branches, playlistId, pinned, pull, uncommitted, indent, onPress }: {
  name: string; desc: string; branch: string; commit: string;
  branches: number; playlistId: string; pinned?: boolean; pull?: boolean;
  uncommitted?: boolean; indent?: boolean; onPress?: () => void;
}) {
  return (
    <div onClick={onPress} style={{
      margin: `4px ${indent ? '36px' : '16px'} 4px ${indent ? '36px' : '16px'}`,
      padding: '10px 12px',
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
      cursor: 'pointer',
    }}>
      <PlaylistArt playlistId={playlistId}/>
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

export function PlaylistsList({ onTab, onPlaylistDetail }: { onTab: (id: TabId) => void; onPlaylistDetail: () => void }) {
  const playlists          = useStore(s => s.playlists);
  const setCurrentPlaylist = useStore(s => s.setCurrentPlaylist);
  const [query, setQuery]  = useState('');

  const displayed = useMemo(() => {
    if (!query.trim()) return playlists;
    const q = query.toLowerCase();
    return playlists.filter(p => p.name.toLowerCase().includes(q));
  }, [playlists, query]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
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

        {displayed.length === 0 ? (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            {query ? 'No playlists match.' : 'No playlists yet.'}
          </div>
        ) : (
          <>
            <SectionHeadPlain label="All playlists" trailing={String(displayed.length)}/>
            {displayed.map(p => {
              const mainBranch = p.branches.find(b => b.name === 'main') ?? p.branches[0];
              const commit = mainBranch?.head_commit?.slice(0, 6) ?? '—';
              return (
                <PlaylistCard
                  key={p.id}
                  playlistId={p.id}
                  name={p.name}
                  desc={p.description ? p.description : `${p.branches.length} branch${p.branches.length !== 1 ? 'es' : ''}`}
                  branch={mainBranch?.name ?? 'main'}
                  commit={commit}
                  branches={p.branches.length}
                  onPress={() => { setCurrentPlaylist(p.id); onPlaylistDetail(); }}
                />
              );
            })}
          </>
        )}

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="playlists" onTab={onTab}/>
    </div>
  );
}
