import { useState, useRef, useEffect } from 'react';
import { ALBUMS } from '../data';
import type { Track } from '../data';
import { IcoDragHandle, IcoDots } from '../icons';
import { FiEdit2, FiTrash2, FiHeart, FiArrowUp } from 'react-icons/fi';

const HEADERS = ['', '#', '', 'Title', 'Artist', 'Album', 'Commit', 'Added', 'Length', ''];

interface TrackListProps {
  tracks:          Track[];
  activeTrackId:   number;
  onSelect:        (id: number) => void;
  onReorder:       (newOrder: Track[] | null) => void;
  hasUncommitted:  boolean;
  onCommitChanges: () => void;
  onEditTrack:     (id: number) => void;
  artworkUrls:     Record<string, string>;
}

export default function TrackList({
  tracks, activeTrackId, onSelect, onReorder,
  hasUncommitted, onCommitChanges, onEditTrack, artworkUrls,
}: TrackListProps) {
  const [dragIdx,     setDragIdx]     = useState<number | null>(null);
  const [dropIdx,     setDropIdx]     = useState<number | null>(null);
  const [menuTrackId, setMenuTrackId] = useState<number | null>(null);
  const [menuPos,     setMenuPos]     = useState({ x: 0, y: 0 });
  const dropIdxRef   = useRef<number | null>(null);
  const rowRefs      = useRef<(HTMLDivElement | null)[]>([]);

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

  // Mouse-based drag — active only while dragIdx is set
  useEffect(() => {
    if (dragIdx === null) return;
    document.body.style.cursor = 'grabbing';

    const onMove = (e: MouseEvent) => {
      let closest: number | null = null;
      let minDist = Infinity;
      rowRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const d = Math.abs(e.clientY - mid);
        if (d < minDist) { minDist = d; closest = i; }
      });
      dropIdxRef.current = closest;
      setDropIdx(closest);
    };

    const onUp = () => {
      const target = dropIdxRef.current;
      document.body.style.cursor = '';
      if (target !== null && target !== dragIdx) {
        const next = [...tracks];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(target, 0, moved);
        onReorder(next);
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
  }, [dragIdx, tracks, onReorder]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Pending changes banner */}
      {hasUncommitted && (
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-mm-accent-dim border-b border-mm-b2 shrink-0">
          <span className="text-[11px] text-mm-accent-lit">
            ● Unsaved changes — commit to record in playlist history
          </span>
          <div className="flex gap-1.5">
            <button onClick={() => onReorder(null)} className="btn btn-ghost btn-xs">Discard</button>
            <button onClick={onCommitChanges} className="btn btn-primary btn-xs">Commit</button>
          </div>
        </div>
      )}

      {/* Column headers */}
      <div
        className="tl-row bg-mm-1 cursor-default sticky top-0 z-[5]"
        style={{ gridTemplateColumns: '18px 24px 28px 1fr 0.65fr 0.65fr 72px 68px 54px 28px' }}
      >
        {HEADERS.map((h, i) => (
          <div key={i} className="tl-cell text-[9px] font-bold tracking-[0.08em] text-mm-t2 uppercase">{h}</div>
        ))}
      </div>

      {/* Track rows */}
      <div className="flex-1 overflow-y-auto styled-scroll">
        {tracks.map((t, idx) => {
          const active     = t.id === activeTrackId;
          const art        = ALBUMS[t.albumRef] ?? ALBUMS[0];
          const artworkUrl = artworkUrls[t.hash];
          return (
            <div
              key={t.id}
              ref={el => { rowRefs.current[idx] = el; }}
              onClick={() => { if (dragIdx === null) onSelect(t.id); }}
              className={`tl-row${active ? ' active-row' : ''}`}
              style={{
                gridTemplateColumns: '18px 24px 28px 1fr 0.65fr 0.65fr 72px 68px 54px 28px',
                opacity: dragIdx === idx ? 0.35 : 1,
                borderTop: dropIdx === idx && dragIdx !== idx ? '2px solid var(--accent)' : undefined,
                transition: 'opacity 0.15s',
              }}
            >
              <div
                className="tl-cell justify-center"
                style={{ cursor: 'grab' }}
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragIdx(idx); }}
              ><IcoDragHandle /></div>
              <div className={`tl-cell text-[10px] ${active ? 'bright' : 'muted'}`}>{active ? '▶' : idx + 1}</div>
              <div className="tl-cell">
                <div className="w-[22px] h-[22px] rounded-[3px] shrink-0" style={{
                  background: artworkUrl
                    ? `url(${artworkUrl}) center/cover no-repeat, ${art.gradient}`
                    : art.gradient,
                }} />
              </div>
              <div className={`tl-cell ${active ? 'bright font-semibold' : ''}`}>{t.title}</div>
              <div className="tl-cell">{t.artist}</div>
              <div className="tl-cell muted">{t.album}</div>
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
                    setMenuPos({ x: r.right, y: r.bottom });
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
            <li><button className="text-mm-t2">Add to queue</button></li>
            <li><button className="text-mm-t2">Add to playlist</button></li>
            <li className="divider my-0" />
            <li>
              <button className="text-error flex items-center gap-2">
                <FiTrash2 size={12} /> Remove from playlist
              </button>
            </li>
          </ul>
        );
      })()}

      {/* Bottom action bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-mm-b0 bg-mm-1 shrink-0">
        <button className="badge badge-ghost gap-1 cursor-pointer hover:bg-mm-4 transition-colors">
          <FiHeart size={12} /> Favorite
        </button>
        <button className="badge badge-ghost gap-1 cursor-pointer hover:bg-mm-4 transition-colors">
          <FiArrowUp size={12} /> Push/Pull
        </button>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-mm-t2">
          {tracks.length} tracks · commit 4fa9b0
        </span>
      </div>
    </div>
  );
}
