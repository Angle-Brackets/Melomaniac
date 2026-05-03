import { useState, useRef, useEffect } from 'react';
import { ALBUMS } from '../data';
import type { Track } from '../data';

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <circle cx="7" cy="2" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
  </svg>
);

const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 2l2.5 2.5L4 11H1.5v-2.5L8.5 2z"/><path d="M7 3.5l2.5 2.5"/>
  </svg>
);

const DragHandle = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ opacity: 0.3, cursor: 'grab', flexShrink: 0 }}>
    <circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>
    <circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/>
    <circle cx="3" cy="11" r="1.3"/><circle cx="7" cy="11" r="1.3"/>
  </svg>
);

const HeartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 13.5S2 9.5 2 5.5a3.5 3.5 0 0 1 6-2.45A3.5 3.5 0 0 1 14 5.5c0 4-6 8-6 8z"/>
  </svg>
);

const PushIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8V2M3 5l3-3 3 3"/><path d="M2 10h8"/>
  </svg>
);

const HEADERS = ['', '#', '', 'Title', 'Artist', 'Album', 'Commit', 'Added', 'Length', ''];

interface TrackListProps {
  tracks: Track[];
  activeTrackId: number;
  onSelect: (id: number) => void;
  onReorder: (newOrder: Track[] | null) => void;
  hasUncommitted: boolean;
  onCommitChanges: () => void;
  onEditTrack: (id: number) => void;
}

export default function TrackList({ tracks, activeTrackId, onSelect, onReorder, hasUncommitted, onCommitChanges, onEditTrack }: TrackListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [menuTrackId, setMenuTrackId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const wasDragging = useRef(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('.tl-context-menu') && !target.closest('.tl-dots-btn')) {
        setMenuTrackId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    wasDragging.current = false;
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    wasDragging.current = true;
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(idx);
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDropIdx(null); return; }
    const next = [...tracks];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
    setDragIdx(null); setDropIdx(null);
  };
  const handleDragEnd = () => {
    setDragIdx(null); setDropIdx(null);
    setTimeout(() => { wasDragging.current = false; }, 50);
  };

  // suppress hoveredRow warning — used for future effects
  void hoveredRow;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* uncommitted banner */}
      {hasUncommitted && (
        <div style={{
          padding: '6px 14px', background: 'var(--accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: '1px solid var(--border-2)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--accent-light)' }}>
            ● Unsaved track reorder — commit to save to playlist history
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onReorder(null)} style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
              border: '1px solid var(--border-2)', background: 'transparent',
              color: 'var(--text-1)', fontFamily: "'Outfit', sans-serif",
            }}>Discard</button>
            <button onClick={onCommitChanges} style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
              border: '1px solid var(--accent)', background: 'var(--bg-5)',
              color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif",
            }}>Commit reorder</button>
          </div>
        </div>
      )}

      {/* header row */}
      <div className="tl-row" style={{
        background: 'var(--bg-1)', cursor: 'default', position: 'sticky', top: 0, zIndex: 5,
        gridTemplateColumns: '18px 24px 28px 1fr 0.65fr 0.65fr 72px 68px 54px 28px',
      }}>
        {HEADERS.map((h, i) => (
          <div key={i} className="tl-cell" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-2)', textTransform: 'uppercase' }}>{h}</div>
        ))}
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
        {tracks.map((t, idx) => {
          const active = t.id === activeTrackId;
          const art = ALBUMS[t.albumRef] ?? ALBUMS[0];
          const isDraggingThis = dragIdx === idx;
          const isDropTarget = dropIdx === idx && dragIdx !== idx;
          return (
            <div
              key={t.id}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={e => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onDoubleClick={() => onSelect(t.id)}
              onClick={() => { if (!wasDragging.current) onSelect(t.id); }}
              onMouseEnter={() => setHoveredRow(t.id)}
              onMouseLeave={() => setHoveredRow(null)}
              className={`tl-row${active ? ' active-row' : ''}`}
              style={{
                gridTemplateColumns: '18px 24px 28px 1fr 0.65fr 0.65fr 72px 68px 54px 28px',
                opacity: isDraggingThis ? 0.35 : 1,
                borderTop: isDropTarget ? '2px solid var(--accent)' : undefined,
                transition: 'opacity 0.15s',
              }}
            >
              <div className="tl-cell" style={{ justifyContent: 'center' }}><DragHandle /></div>
              <div className={`tl-cell${active ? ' bright' : ' muted'}`} style={{ fontSize: 10 }}>{active ? '▶' : idx + 1}</div>
              <div className="tl-cell">
                <div style={{ width: 22, height: 22, borderRadius: 3, background: art.gradient, flexShrink: 0 }} />
              </div>
              <div className={`tl-cell${active ? ' bright' : ''}`} style={{ fontWeight: active ? 600 : 400 }}>{t.title}</div>
              <div className="tl-cell">{t.artist}</div>
              <div className="tl-cell muted">{t.album}</div>
              <div className="tl-cell mono">{t.commit}</div>
              <div className="tl-cell muted" style={{ fontSize: 10 }}>{t.added}</div>
              <div className="tl-cell muted" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{t.length}</div>
              <div className="tl-cell" style={{ justifyContent: 'center', position: 'relative' }}>
                <div
                  className="tl-dots-btn"
                  onClick={e => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenuPos({ x: r.right, y: r.bottom });
                    setMenuTrackId(menuTrackId === t.id ? null : t.id);
                  }}
                  style={{
                    color: 'var(--text-3)', cursor: 'pointer', padding: '2px 4px', borderRadius: 3,
                    transition: 'color 0.14s, background 0.14s',
                    background: menuTrackId === t.id ? 'var(--bg-5)' : 'transparent',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-4)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = menuTrackId === t.id ? 'var(--text-1)' : 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = menuTrackId === t.id ? 'var(--bg-5)' : 'transparent'; }}
                ><DotsIcon /></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* context menu portal */}
      {menuTrackId !== null && (() => {
        const t = tracks.find(tr => tr.id === menuTrackId);
        if (!t) return null;
        return (
          <div className="tl-context-menu" style={{
            position: 'fixed',
            left: Math.min(menuPos.x, window.innerWidth - 170),
            top: menuPos.y,
            zIndex: 9999,
            background: 'var(--bg-3)', border: '1px solid var(--border-2)',
            borderRadius: 7, boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
            minWidth: 164, overflow: 'hidden',
          }}>
            <div onClick={e => { e.stopPropagation(); onEditTrack(t.id); setMenuTrackId(null); }}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-5)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-0)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
            ><PencilIcon /><span>Open in Editor</span></div>
            <div style={{ height: 1, background: 'var(--border-0)', margin: '0 8px' }} />
            <ContextMenuItem label="Add to queue" />
            <ContextMenuItem label="Add to playlist" />
            <div style={{ height: 1, background: 'var(--border-0)', margin: '0 8px' }} />
            <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: '#e06060', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg-5)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 3h8M5 3V2h2v1M4 3v6h4V3"/></svg>
              <span>Remove from playlist</span>
            </div>
          </div>
        );
      })()}

      {/* action bar */}
      <div style={{
        padding: '5px 10px', display: 'flex', gap: 6, alignItems: 'center',
        borderTop: '1px solid var(--border-0)', background: 'var(--bg-1)', flexShrink: 0,
      }}>
        <button className="chip"><HeartIcon /> Favorite</button>
        <button className="chip"><PushIcon /> Push/Pull</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
          {tracks.length} tracks · commit 4fa9b0
        </span>
      </div>
    </div>
  );
}

function ContextMenuItem({ label }: { label: string }) {
  return (
    <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-5)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
    >
      <span>{label}</span>
    </div>
  );
}
