import { useEffect, useRef, useState } from 'react';
import type { Track } from '../data';
import { ALBUMS } from '../data';
import { FiX } from 'react-icons/fi';

interface QueuePanelProps {
  playQueue:      Track[];
  manualQueue:    Track[];
  loadedHash:     string | null;
  artworkUrls:    Record<string, string>;
  onRemoveManual: (idx: number) => void;
  onClearManual:  () => void;
  onClose:        () => void;
}

const ENTER_MS = 200;
const EXIT_MS  = 150;

const panelKeyframes = `
@keyframes qp-enter {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes qp-exit {
  from { opacity: 1; transform: translateY(0)    scale(1);    }
  to   { opacity: 0; transform: translateY(8px)  scale(0.97); }
}
@keyframes qp-row {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0);    }
}
`;

function TrackRow({
  track, artworkUrls, onRemove, animDelay = 0,
}: {
  track: Track;
  artworkUrls: Record<string, string>;
  onRemove?: () => void;
  animDelay?: number;
}) {
  const art = ALBUMS[track.albumRef] ?? ALBUMS[0];
  const artUrl = artworkUrls[track.hash];
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px',
        animation: `qp-row ${ENTER_MS}ms ease-out both`,
        animationDelay: `${animDelay}ms`,
      }}
      className="group hover:bg-mm-3 rounded transition-colors"
    >
      <div style={{
        width: 28, height: 28, borderRadius: 3, flexShrink: 0,
        background: artUrl ? `url(${artUrl}) center/cover no-repeat, ${art.gradient}` : art.gradient,
        border: '1px solid var(--border-0)',
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, color: 'var(--text-0)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontFamily: "'Outfit', sans-serif",
        }}>{track.title}</div>
        <div style={{
          fontSize: 10, color: 'var(--text-2)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontFamily: "'Outfit', sans-serif",
        }}>{track.artist}</div>
      </div>
      {onRemove && (
        <button
          className="btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="Remove"
          style={{ flexShrink: 0, color: 'var(--text-3)' }}
        >
          <FiX size={11} />
        </button>
      )}
    </div>
  );
}

export default function QueuePanel({
  playQueue, manualQueue, loadedHash,
  artworkUrls, onRemoveManual, onClearManual, onClose,
}: QueuePanelProps) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  const dismiss = () => {
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nowPlayingIdx = playQueue.findIndex(t => t.hash === loadedHash);
  const upcomingTracks = nowPlayingIdx >= 0
    ? playQueue.slice(nowPlayingIdx + 1, nowPlayingIdx + 11)
    : playQueue.slice(0, 10);
  const nowPlaying = nowPlayingIdx >= 0 ? playQueue[nowPlayingIdx] : null;

  // Assign staggered delays after header (row 0 = nowPlaying, then manualQueue items, then upcoming)
  let rowIdx = 0;
  const rowDelay = () => {
    const d = 30 + rowIdx * 28;
    rowIdx++;
    return d;
  };

  return (
    <>
      <style>{panelKeyframes}</style>
      <div
        ref={panelRef}
        style={{
          position: 'absolute',
          bottom: 68, right: 10,
          width: 280,
          maxHeight: 420,
          background: 'var(--bg-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          zIndex: 50,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: closing
            ? `qp-exit ${EXIT_MS}ms ease-in both`
            : `qp-enter ${ENTER_MS}ms cubic-bezier(0.22,1,0.36,1) both`,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px 7px',
          borderBottom: '1px solid var(--border-1)',
          background: 'var(--bg-1)',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-0)',
            fontFamily: "'Outfit', sans-serif", letterSpacing: '0.02em',
          }}>Queue</span>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={dismiss}
            style={{ color: 'var(--text-3)' }}
          ><FiX size={12} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">

          {/* Now Playing */}
          {nowPlaying && (
            <div>
              <div style={{
                padding: '7px 10px 3px',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                animation: `qp-row ${ENTER_MS}ms ease-out both`,
                animationDelay: '20ms',
              }}>
                Now Playing
              </div>
              <TrackRow track={nowPlaying} artworkUrls={artworkUrls} animDelay={rowDelay()} />
            </div>
          )}

          {/* Manual queue */}
          {manualQueue.length > 0 && (
            <div>
              <div style={{
                padding: '7px 10px 3px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                animation: `qp-row ${ENTER_MS}ms ease-out both`,
                animationDelay: `${30 + rowIdx * 28}ms`,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
                  Up Next
                </span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={onClearManual}
                  style={{ fontSize: 9, height: 16, minHeight: 'unset', padding: '0 4px', color: 'var(--text-3)' }}
                >Clear all</button>
              </div>
              {manualQueue.map((t, i) => (
                <TrackRow
                  key={`manual-${t.hash}-${i}`}
                  track={t}
                  artworkUrls={artworkUrls}
                  animDelay={rowDelay()}
                  onRemove={() => onRemoveManual(i)}
                />
              ))}
            </div>
          )}

          {/* Coming up from play queue */}
          {upcomingTracks.length > 0 && (
            <div>
              <div style={{
                padding: '7px 10px 3px',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                animation: `qp-row ${ENTER_MS}ms ease-out both`,
                animationDelay: `${30 + rowIdx * 28}ms`,
              }}>
                Coming Up
              </div>
              {upcomingTracks.map((t, i) => (
                <TrackRow
                  key={`upcoming-${t.hash}-${i}`}
                  track={t}
                  artworkUrls={artworkUrls}
                  animDelay={rowDelay()}
                />
              ))}
            </div>
          )}

          {!nowPlaying && manualQueue.length === 0 && upcomingTracks.length === 0 && (
            <div style={{
              padding: '24px 10px', textAlign: 'center',
              color: 'var(--text-3)', fontSize: 11, fontFamily: "'Outfit', sans-serif",
              animation: `qp-row ${ENTER_MS}ms ease-out 40ms both`,
            }}>
              Nothing in the queue yet
            </div>
          )}

        </div>
      </div>
    </>
  );
}
