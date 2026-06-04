import { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ALBUMS } from '../data';
import type { Track } from '../data';
import { IcoDragHandle, IcoDots } from '../icons';
import { FiEdit2, FiTrash2, FiHeart, FiArrowUp, FiPlay, FiPause, FiSearch, FiX, FiChevronDown } from 'react-icons/fi';
import ScrollText from './ScrollText';

const HEADERS = ['', '#', '', 'Title', 'Artist', 'Album', 'Commit', 'Added', 'Length', ''];

// Row height (px) per density — must match CSS padding + content + border
const ROW_HEIGHT: Record<string, number> = { compact: 26, normal: 30, relaxed: 34 };

interface TrackListProps {
  tracks: Track[];
  activeTrackId: number;
  loadedHash: string | null;
  isPlaying: boolean;
  onSelect: (id: number) => void;
  onPlayPause: (id: number) => void;
  onReorder: ((newOrder: Track[] | null) => void) | null;
  hasUncommitted: boolean;
  onCommitChanges: () => void;
  onEditTrack: (id: number) => void;
  artworkUrls: Record<string, string>;
  onRemoveTrack?: (hash: string) => void;
  onAddTracks?: () => void;
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  density?: 'compact' | 'normal' | 'relaxed';
  favorites?: Set<string>;
  onCollapse?: () => void;
}

export default function TrackList({
  tracks, activeTrackId, loadedHash, isPlaying, onSelect, onPlayPause, onReorder,
  hasUncommitted, onCommitChanges, onEditTrack, artworkUrls,
  onRemoveTrack, onAddTracks, onPlayNext, onAddToQueue, density = 'relaxed', favorites, onCollapse,
}: TrackListProps): JSX.Element {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [menuTrackId, setMenuTrackId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState('');
  const dropIdxRef = useRef<number | null>(null);
  const parentRef  = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  const rowHeight = ROW_HEIGHT[density] ?? 34;

  const displayTracks = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album ?? '').toLowerCase().includes(q),
    );
  }, [tracks, search]);

  const virtualizer = useVirtualizer({
    count: displayTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  // Close context menu on outside click
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

  // Mouse-based drag — coordinate approach works for all rows including non-rendered ones
  useEffect(() => {
    if (dragIdx === null) return;
    document.body.style.cursor = 'grabbing';

    const onMove = (e: MouseEvent) => {
      if (!parentRef.current) return;
      const rect = parentRef.current.getBoundingClientRect();
      const relY  = e.clientY - rect.top + parentRef.current.scrollTop;
      const idx   = Math.round(Math.min(Math.max(0, relY / rowHeight), displayTracks.length - 1));
      dropIdxRef.current = idx;
      setDropIdx(idx);
    };

    const onUp = () => {
      const target = dropIdxRef.current;
      document.body.style.cursor = '';
      if (target !== null && target !== dragIdx) {
        const next = [...displayTracks];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(target, 0, moved);
        onReorder?.(next);
      }
      dropIdxRef.current = null;
      setDragIdx(null);
      setDropIdx(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
  }, [dragIdx, displayTracks, onReorder, rowHeight]);

  const COLS = '18px 24px 28px 1fr 0.65fr 0.65fr 72px 68px 54px 28px';

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-density={density}>

      {/* Pending changes banner */}
      {hasUncommitted && (
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-mm-accent-dim border-b border-mm-b2 shrink-0">
          <span className="text-[11px] text-mm-accent-lit">
            ● Unsaved changes — commit to record in playlist history
          </span>
          <div className="flex gap-1.5">
            <button onClick={() => onReorder?.(null)} className="btn btn-ghost btn-xs">Discard</button>
            <button onClick={onCommitChanges} className="btn btn-primary btn-xs">Commit</button>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-1 bg-mm-1 border-b border-mm-b0 shrink-0">
        <FiSearch size={11} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <input
          ref={searchRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tracks…"
          className="flex-1 bg-transparent outline-none text-mm-t1"
          style={{ fontSize: 11, fontFamily: "'Outfit', sans-serif", minWidth: 0 }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ color: 'var(--text-3)', display: 'flex', flexShrink: 0 }}>
            <FiX size={11} />
          </button>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse track list"
            style={{ color: 'var(--text-2)', display: 'flex', flexShrink: 0, padding: '2px 4px', cursor: 'pointer', lineHeight: 1 }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-0)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-2)')}
          >
            <FiChevronDown size={15} />
          </button>
        )}
      </div>

      {/* Column headers */}
      <div
        className="tl-row bg-mm-1 cursor-default shrink-0"
        style={{ gridTemplateColumns: COLS }}
      >
        {HEADERS.map((h, i) => (
          <div key={i} className="tl-cell text-[9px] font-bold tracking-[0.08em] text-mm-t2 uppercase">{h}</div>
        ))}
      </div>

      {/* Virtual track rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto styled-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map(vItem => {
            const idx = vItem.index;
            const t   = displayTracks[idx];
            if (!t) return null;
            const active     = t.id === activeTrackId;
            const art        = ALBUMS[t.albumRef] ?? ALBUMS[0];
            const artworkUrl = artworkUrls[t.hash];
            return (
              <div
                key={t.id}
                onClick={() => { if (dragIdx === null) onSelect(t.id); }}
                className={`tl-row${active ? ' active-row' : ''}`}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                  gridTemplateColumns: COLS,
                  opacity: dragIdx === idx ? 0.35 : 1,
                  borderTop: dropIdx === idx && dragIdx !== idx ? '2px solid var(--accent)' : undefined,
                }}
              >
                <div
                  className="tl-cell justify-center"
                  style={{ cursor: 'grab' }}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragIdx(idx); }}
                ><IcoDragHandle /></div>

                <div className="tl-cell justify-center group/playbtn">
                  <button
                    className="flex items-center justify-center w-full h-full focus:outline-none transition-colors"
                    onClick={e => { e.stopPropagation(); onPlayPause(t.id); }}
                  >
                    {t.hash === loadedHash ? (
                      <span className="text-mm-accent group-hover/playbtn:opacity-70 transition-opacity">
                        {isPlaying
                          ? <FiPause size={12} strokeWidth={2} />
                          : <FiPlay size={12} strokeWidth={2.5} />}
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] text-mm-t3 group-hover/playbtn:hidden">{idx + 1}</span>
                        <span className="hidden text-mm-t2 group-hover/playbtn:flex transition-opacity">
                          <FiPlay size={12} strokeWidth={2.5} />
                        </span>
                      </>
                    )}
                  </button>
                </div>

                <div className="tl-cell">
                  <div className="w-[22px] h-[22px] rounded-[3px] shrink-0" style={{
                    background: artworkUrl
                      ? `url(${artworkUrl}) center/cover no-repeat, ${art.gradient}`
                      : art.gradient,
                  }} />
                </div>
                <div className={`tl-cell ${active ? 'bright font-semibold' : ''}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <ScrollText text={t.title} style={{ flex: '0 1 auto', minWidth: 0 }} />
                    {favorites?.has(t.hash) && (
                      <FiHeart size={9} style={{ fill: 'currentColor', color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                  </div>
                </div>
                <div className="tl-cell"><ScrollText text={t.artist} style={{ flex: 1 }} /></div>
                <div className="tl-cell muted"><ScrollText text={t.album ?? ''} style={{ flex: 1 }} /></div>
                <div className="tl-cell mono">{t.commit}</div>
                <div className="tl-cell muted text-[10px]">{t.added}</div>
                <div className="tl-cell muted font-mono text-[10px]">{t.length}</div>

                {/* Context menu trigger */}
                <div className="tl-cell justify-center relative">
                  <button
                    className="tl-dots-btn btn btn-ghost btn-xs btn-square text-mm-t3"
                    onClick={e => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenuPos({ x: r.right, y: Math.min(r.bottom, window.innerHeight - 140) });
                      setMenuTrackId(menuTrackId === t.id ? null : t.id);
                    }}
                  >
                    <IcoDots size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Context menu portal */}
      {menuTrackId !== null && (() => {
        const t = tracks.find(tr => tr.id === menuTrackId);
        if (!t) return null;
        return (
          <ul
            className="tl-context-menu menu menu-sm bg-mm-3 border border-mm-b2 rounded-lg shadow-xl fixed z-[9999] min-w-[164px] p-1"
            style={{
              left: Math.min(menuPos.x, window.innerWidth - 170),
              top: menuPos.y,
            }}
          >
            <li>
              <button
                className="flex items-center gap-2 text-mm-t1"
                onClick={e => { e.stopPropagation(); onEditTrack(t.id); setMenuTrackId(null); }}
              >
                <FiEdit2 size={12} /> Open in Editor
              </button>
            </li>
            {onPlayNext && (
              <li>
                <button
                  className="flex items-center gap-2 text-mm-t1"
                  onClick={e => { e.stopPropagation(); onPlayNext(t); setMenuTrackId(null); }}
                >
                  Play next
                </button>
              </li>
            )}
            {onAddToQueue && (
              <li>
                <button
                  className="flex items-center gap-2 text-mm-t1"
                  onClick={e => { e.stopPropagation(); onAddToQueue(t); setMenuTrackId(null); }}
                >
                  Add to queue
                </button>
              </li>
            )}
            {onRemoveTrack && (
              <>
                <li className="divider my-0" />
                <li>
                  <button
                    className="text-error flex items-center gap-2"
                    onClick={e => { e.stopPropagation(); onRemoveTrack(t.hash); setMenuTrackId(null); }}
                  >
                    <FiTrash2 size={12} /> Remove from playlist
                  </button>
                </li>
              </>
            )}
          </ul>
        );
      })()}

      {/* Bottom action bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-mm-b0 bg-mm-1 shrink-0">
        {onAddTracks ? (
          <button
            className="badge badge-ghost gap-1 cursor-pointer hover:bg-mm-4 transition-colors"
            onClick={onAddTracks}
          >
            <FiArrowUp size={12} style={{ transform: 'rotate(0deg)' }} /> Add tracks
          </button>
        ) : (
          <button className="badge badge-ghost gap-1 cursor-pointer hover:bg-mm-4 transition-colors">
            <FiHeart size={12} /> Favorite
          </button>
        )}
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-mm-t2">
          {search
            ? `${displayTracks.length} of ${tracks.length} tracks`
            : `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  );
}
