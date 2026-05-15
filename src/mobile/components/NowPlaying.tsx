import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { RepeatMode, ShuffleMode } from '../../store/types';
import type { TrackRecord, PlaylistRecord, PlaylistTrackRecord } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef } from '../playerContext';
import { Icons } from '../icons';
import { MMArt, MMSheet, MMTabBar } from './common';
import type { TabId } from './common';

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function CoverflowCard({ track, size, glow }: { track: TrackRecord; size: number; glow: boolean }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return <MMArt src={artUrl ?? undefined} size={size} radius={14} glow={glow}/>;
}

function UpNextCard({ track }: { track: TrackRecord }) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  return (
    <>
      <MMArt src={artUrl ?? undefined} size={28} radius={5}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
      </div>
    </>
  );
}

function PlaylistSwitcherCard({ playlist, active, onSelect }: {
  playlist: PlaylistRecord; active: boolean; onSelect: () => void;
}) {
  const artUrl = usePlaylistArtwork(playlist.id);
  return (
    <div onClick={onSelect} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px',
      borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer',
    }}>
      <MMArt src={artUrl ?? undefined} size={44} radius={8}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playlist.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          {playlist.branches.length} branch{playlist.branches.length !== 1 ? 'es' : ''}
        </div>
      </div>
      {active && <Icons.check size={16} stroke="var(--accent)"/>}
    </div>
  );
}

function SecondaryBtn({ Icon, active, color = 'var(--accent)', onClick }: {
  Icon: (p: { size?: number }) => React.ReactElement;
  active: boolean;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      width: 46, height: 46, borderRadius: 23,
      background: active ? `${color}1c` : 'transparent',
      border: active ? `1px solid ${color}55` : '1px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: active ? color : 'var(--text-1)',
    }}>
      <Icon size={20}/>
    </button>
  );
}

function MMCoverflow({ tracks, activeIndex, size = 200 }: {
  tracks: TrackRecord[];
  activeIndex: number;
  size?: number;
}) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const cardRefs  = useRef<(HTMLDivElement | null)[]>([]);
  const posRef    = useRef(activeIndex);
  const dragX     = useRef<number | null>(null);
  const dragP     = useRef(0);
  const dragging  = useRef(false);
  const animFr    = useRef<number | null>(null);
  // centeredIdx is React state purely for the glow re-render — updated only at drag/anim end
  const [centeredIdx, setCenteredIdx] = useState(activeIndex);

  // Write transforms imperatively — no React re-render per frame
  const applyTransforms = useCallback((pos: number) => {
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const off = i - pos, abs = Math.abs(off);
      if (abs > 2.5) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform  = `translateX(${off * (size * 0.62)}px) scale(${1 - Math.min(abs, 2) * 0.18}) rotateY(${-off * 26}deg) translateZ(${-Math.min(abs, 2) * 60}px)`;
      el.style.opacity    = String(Math.max(0.18, 1 - abs * 0.32));
      el.style.zIndex     = String(Math.round(10 - abs));
    });
  }, [size]);

  // After every React render (tracks added/removed, parent state change) re-sync transforms
  useEffect(() => { applyTransforms(posRef.current); });

  // When the playing track changes, animate the coverflow to the new position
  const prevActiveRef = useRef(activeIndex);
  useEffect(() => {
    if (prevActiveRef.current === activeIndex) return;
    prevActiveRef.current = activeIndex;
    animateTo(activeIndex);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const animateTo = (t: number) => {
    if (animFr.current) cancelAnimationFrame(animFr.current);
    // Clamp in case the queue changed while we were browsing
    posRef.current = Math.max(0, Math.min(tracks.length - 1, posRef.current));
    const s = posRef.current, d = t - s;
    if (Math.abs(d) < 0.001) { posRef.current = t; applyTransforms(t); setCenteredIdx(Math.round(t)); return; }
    const t0 = performance.now(), dur = 340;
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      posRef.current = s + d * e;
      applyTransforms(posRef.current);
      if (p < 1) animFr.current = requestAnimationFrame(step);
      else setCenteredIdx(Math.round(t));
    };
    animFr.current = requestAnimationFrame(step);
  };

  const startDrag = (x: number) => {
    if (animFr.current) cancelAnimationFrame(animFr.current);
    dragX.current = x; dragP.current = posRef.current; dragging.current = false;
  };
  const moveDrag = (x: number) => {
    if (dragX.current === null) return;
    const dx = x - dragX.current;
    if (Math.abs(dx) > 4) dragging.current = true;
    if (!dragging.current) return;
    const w = wrapRef.current?.offsetWidth || 360;
    posRef.current = Math.max(0, Math.min(tracks.length - 1, dragP.current - dx / (w / 2.5)));
    applyTransforms(posRef.current);
  };
  const endDrag = () => {
    if (dragX.current === null) return;
    const was = dragging.current;
    dragX.current = null; dragging.current = false;
    if (!was) return;
    const snapped = Math.max(0, Math.min(tracks.length - 1, Math.round(posRef.current)));
    animateTo(snapped);
  };

  if (tracks.length === 0) {
    return (
      <div style={{ width: '100%', height: size + 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <MMArt size={size} radius={14}/>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onTouchStart={e => startDrag(e.touches[0].clientX)}
      onTouchMove={e => moveDrag(e.touches[0].clientX)}
      onTouchEnd={endDrag}
      onMouseDown={e => { e.preventDefault(); startDrag(e.clientX); }}
      onMouseMove={e => { if (dragX.current !== null) moveDrag(e.clientX); }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      style={{
        position: 'relative', width: '100%', height: size + 32,
        perspective: '900px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'pan-y', userSelect: 'none', cursor: 'grab',
      }}
    >
      {tracks.map((track, i) => (
        <div
          key={track.hash}
          ref={el => { cardRefs.current[i] = el; }}
          style={{ position: 'absolute', left: '50%', marginLeft: -size / 2, willChange: 'transform' }}
        >
          <CoverflowCard track={track} size={size} glow={i === centeredIdx}/>
        </div>
      ))}
    </div>
  );
}

export function NowPlaying({ onTab }: { onTab: (id: TabId) => void }) {
  const loadedTrackHash    = useStore(s => s.loadedTrackHash);
  const isPlaying          = useStore(s => s.isPlaying);
  const duration_ms        = useStore(s => s.duration_ms);
  const setPlaying         = useStore(s => s.setPlaying);
  const setLoaded          = useStore(s => s.setLoaded);
  const tracks             = useStore(s => s.tracks);
  const queueTracks        = useStore(s => s.queueTracks);
  const currentIndex       = useStore(s => s.currentIndex);
  const advance            = useStore(s => s.advance);
  const retreat            = useStore(s => s.retreat);
  const loadQueue          = useStore(s => s.loadQueue);
  const shuffle            = useStore(s => s.shuffle);
  const repeat             = useStore(s => s.repeat);
  const setShuffle         = useStore(s => s.setShuffle);
  const setRepeat          = useStore(s => s.setRepeat);
  const toggleFavorite     = useStore(s => s.toggleFavorite);
  const playlists          = useStore(s => s.playlists);
  const currentPlaylistId  = useStore(s => s.currentPlaylistId);
  const setCurrentPlaylist = useStore(s => s.setCurrentPlaylist);

  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId) ?? null;
  const [showSwitcher, setShowSwitcher] = useState(false);

  const currentTrack = tracks.find(t => t.hash === loadedTrackHash) ?? null;
  // Prefetch current track artwork into the shared cache; CoverflowCard will pick it up instantly
  useTrackArtwork(loadedTrackHash ?? '', currentTrack?.artwork_hash ?? null);

  // Seek bar DOM refs — updated by rAF, never by React state
  const seekFillRef = useRef<HTMLDivElement>(null);
  const posTextRef  = useRef<HTMLSpanElement>(null);
  const durTextRef  = useRef<HTMLSpanElement>(null);
  const thumbRef    = useRef<HTMLDivElement>(null);
  const durRef      = useRef(duration_ms);
  useEffect(() => { durRef.current = duration_ms; }, [duration_ms]);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const pos = positionMsRef.current;
      const dur = durRef.current;
      if (dur > 0) {
        const pct = Math.min(pos / dur, 1) * 100;
        if (seekFillRef.current) seekFillRef.current.style.width = `${pct}%`;
        if (thumbRef.current)    thumbRef.current.style.left    = `${pct}%`;
        if (posTextRef.current)  posTextRef.current.textContent = fmtMs(pos);
        if (durTextRef.current)  durTextRef.current.textContent = fmtMs(dur);
      } else {
        if (posTextRef.current) posTextRef.current.textContent = '0:00';
        if (durTextRef.current) durTextRef.current.textContent = '0:00';
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queueRecords: TrackRecord[] = queueTracks
    .map(h => tracks.find(t => t.hash === h))
    .filter((t): t is TrackRecord => t !== undefined);
  const nextTrack = queueRecords[currentIndex + 1] ?? null;

  const playTrack = (track: TrackRecord) => {
    setLoaded(track.hash, track.duration_ms);
    positionMsRef.current = 0;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    setPlaying(true);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      invoke('audio_pause').catch(console.error);
      setPlaying(false);
    } else {
      invoke('audio_play').catch(console.error);
      setPlaying(true);
    }
  };

  const handleNext = () => {
    advance();
    const hash = useStore.getState().currentHash();
    if (!hash) return;
    const track = useStore.getState().tracks.find(t => t.hash === hash);
    if (track) playTrack(track);
  };

  const handlePrev = () => {
    if (positionMsRef.current > 3000) {
      positionMsRef.current = 0;
      invoke('audio_seek', { positionMs: 0 }).catch(console.error);
    } else {
      retreat();
      const hash = useStore.getState().currentHash();
      if (!hash) return;
      const track = useStore.getState().tracks.find(t => t.hash === hash);
      if (track) playTrack(track);
    }
  };

  const handleSeekBack = () => {
    const newPos = Math.max(0, positionMsRef.current - 10000);
    positionMsRef.current = newPos;
    invoke('audio_seek', { positionMs: newPos }).catch(console.error);
  };

  const handleSeekFwd = () => {
    const dur = durRef.current;
    if (dur <= 0) return;
    const newPos = Math.min(dur - 1000, positionMsRef.current + 10000);
    positionMsRef.current = newPos;
    invoke('audio_seek', { positionMs: newPos }).catch(console.error);
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newPos = Math.round(pct * durRef.current);
    positionMsRef.current = newPos;
    invoke('audio_seek', { positionMs: newPos }).catch(console.error);
  };

  // Coverflow browsing is purely visual — never touches the queue cursor.
  // currentIndex only changes via advance/retreat/explicit play so auto-advance stays correct.

  const handleShuffle = () => {
    setShuffle(shuffle === ShuffleMode.Off ? ShuffleMode.Smart : ShuffleMode.Off);
  };

  const handleRepeat = () => {
    const cycle = [RepeatMode.None, RepeatMode.All, RepeatMode.One] as const;
    setRepeat(cycle[(cycle.indexOf(repeat) + 1) % cycle.length]);
  };

  const accent = 'var(--accent)';
  const btnStyle = (): React.CSSProperties => ({
    width: 44, height: 44, background: 'transparent', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', borderRadius: 22,
  });

  const coverflowItems = queueRecords.length > 0
    ? queueRecords
    : currentTrack ? [currentTrack] : [];

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%',
        background: `radial-gradient(circle, var(--accent)38 0%, var(--accent)10 35%, transparent 70%)`,
        filter: 'blur(20px)', pointerEvents: 'none',
      }}/>

      <div style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 16 }}>

        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 22px 18px' }}>
          <button
            onClick={() => setShowSwitcher(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-2)', letterSpacing: 0.12, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>Playing from</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-0)', fontWeight: 500 }}>
                {currentPlaylist?.name ?? currentTrack?.album ?? (loadedTrackHash ? 'Library' : 'Nothing Playing')}
                <Icons.chevDown size={13} stroke="var(--text-2)"/>
              </span>
            </div>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
            <Icons.sync size={13} stroke="var(--green)"/>
            <span>{queueTracks.length > 0 ? `${currentIndex + 1} / ${queueTracks.length}` : '—'}</span>
          </div>
        </div>

        {/* coverflow */}
        <div style={{ flexShrink: 0, marginTop: 12, marginBottom: 18 }}>
          <MMCoverflow
            tracks={coverflowItems}
            activeIndex={Math.min(currentIndex, Math.max(0, coverflowItems.length - 1))}
            size={208}
          />
        </div>

        {/* track info */}
        <div style={{ padding: '8px 28px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>
            {currentTrack?.title ?? '—'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-1)', marginTop: 4 }}>
            {currentTrack
              ? `${currentTrack.artist}${currentTrack.album ? ` · ${currentTrack.album}` : ''}`
              : 'No track loaded'}
          </div>
        </div>

        {/* seek bar */}
        <div style={{ padding: '22px 28px 12px' }}>
          <div
            onClick={handleSeekClick}
            style={{ position: 'relative', height: 28, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          >
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--bg-3)', position: 'relative', overflow: 'visible' }}>
              <div ref={seekFillRef} style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%',
                background: `linear-gradient(90deg, ${accent}, var(--accent-light))`, borderRadius: 2,
                boxShadow: `0 0 12px ${accent}88`,
              }}/>
              <div ref={thumbRef} style={{
                position: 'absolute', left: '0%', top: '50%',
                width: 14, height: 14, transform: 'translate(-50%,-50%)',
                background: 'var(--text-0)', borderRadius: '50%',
                boxShadow: `0 0 8px ${accent}, 0 2px 6px rgba(0,0,0,0.5)`,
              }}/>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span ref={posTextRef} style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>0:00</span>
            <span ref={durTextRef} style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>0:00</span>
          </div>
        </div>

        {/* transport */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 36px 4px' }}>
          <button style={btnStyle()} onClick={handlePrev}><Icons.prev size={26} stroke="var(--text-0)"/></button>
          <button style={btnStyle()} onClick={handleSeekBack}><Icons.skipBack size={28} stroke="var(--text-1)"/></button>
          <button onClick={handlePlayPause} style={{
            width: 70, height: 70, borderRadius: 35, border: 'none',
            background: `linear-gradient(135deg, var(--accent-light), ${accent})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 8px 26px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.25)`,
            color: 'var(--bg-0)', cursor: 'pointer',
          }}>
            {isPlaying ? <Icons.pause size={28}/> : <Icons.play size={28}/>}
          </button>
          <button style={btnStyle()} onClick={handleSeekFwd}><Icons.skipFwd size={28} stroke="var(--text-1)"/></button>
          <button style={btnStyle()} onClick={handleNext}><Icons.next size={26} stroke="var(--text-0)"/></button>
        </div>

        {/* secondary controls */}
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '20px 32px 8px' }}>
          <SecondaryBtn Icon={Icons.shuffle} active={shuffle !== ShuffleMode.Off} onClick={handleShuffle}/>
          <SecondaryBtn
            Icon={Icons.heartFill}
            active={currentTrack?.favorited ?? false}
            color={accent}
            onClick={() => currentTrack && toggleFavorite(currentTrack.hash)}
          />
          <SecondaryBtn
            Icon={repeat === RepeatMode.One ? Icons.loopOne : Icons.loop}
            active={repeat !== RepeatMode.None}
            onClick={handleRepeat}
          />
          <SecondaryBtn Icon={Icons.queue} active={false}/>
        </div>

        {/* spacer so secondary controls don't sit against the Up Next card */}
        <div style={{ flex: 1, minHeight: 8 }}/>
      </div>

      {/* Up Next — pinned above tab bar, never overlaps layout flow */}
      {nextTrack && (
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 94, zIndex: 20,
          padding: '10px 14px',
          background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
          borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 10, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>Up next</div>
          <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <UpNextCard track={nextTrack}/>
          </div>
          <div style={{ flexShrink: 0 }}><Icons.chevRight size={16} stroke="var(--text-2)"/></div>
        </div>
      )}

      <MMTabBar active="now" onTab={onTab}/>

      {/* Playlist quick switcher */}
      {showSwitcher && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setShowSwitcher(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet title="Switch Source" subtitle={`${playlists.length} playlists`} height="70%">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Library option */}
              <div onClick={() => {
                setCurrentPlaylist('');
                setShowSwitcher(false);
              }} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px',
                borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer',
              }}>
                <MMArt size={44} radius={8}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}>Library</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{tracks.length} tracks</div>
                </div>
                {!currentPlaylistId && <Icons.check size={16} stroke="var(--accent)"/>}
              </div>
              {playlists.map(p => (
                <PlaylistSwitcherCard
                  key={p.id}
                  playlist={p}
                  active={p.id === currentPlaylistId}
                  onSelect={async () => {
                    setCurrentPlaylist(p.id);
                    try {
                      const ptracks = await invoke<PlaylistTrackRecord[]>('playlist_get_tracks', {
                        playlistId: p.id, branchName: 'main',
                      });
                      loadQueue(ptracks.map(t => t.hash));
                    } catch { /* keep existing queue */ }
                    setShowSwitcher(false);
                  }}
                />
              ))}
            </div>
          </MMSheet>
        </div>
      )}
    </div>
  );
}
