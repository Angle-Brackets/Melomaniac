import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import type { Track, TrackRecord } from '../data';
import { trackRecordToTrack } from '../data';
import { IcoMusicLib, IcoDownload, IcoClose } from '../icons';
import { FiSearch, FiFolder, FiFilePlus, FiTrash2, FiEdit2, FiPlus, FiTag, FiPlay, FiHeart } from 'react-icons/fi';
import ScrollText from './ScrollText';
import AddToPlaylistModal from './AddToPlaylistModal';
import BulkEditPanel from './BulkEditPanel';
import DownloadModal from './DownloadModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type SortField = 'title' | 'artist' | 'album' | 'duration_ms' | 'ingested_at';
type SortDir   = 'asc' | 'desc';
type Filter    = 'all' | 'new' | 'stray' | 'local' | 'downloaded';
type ColKey    = 'title' | 'artist' | 'album' | 'source';

interface ColWidths { title: number; artist: number; album: number; source: number; }
const DEFAULT_COLS: ColWidths = { title: 280, artist: 160, album: 160, source: 100 };

function buildCOL(w: ColWidths) {
  return `28px 28px ${w.title}px ${w.artist}px ${w.album}px 52px ${w.source}px`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const SORT_KEY = 'melo-lib-sort';
const COLS_KEY = 'melo-lib-cols';

function loadSort(): { field: SortField; dir: SortDir } {
  try { const r = localStorage.getItem(SORT_KEY); if (r) return JSON.parse(r); } catch {}
  return { field: 'artist', dir: 'asc' };
}

function loadCols(): ColWidths {
  try { const r = localStorage.getItem(COLS_KEY); if (r) return { ...DEFAULT_COLS, ...JSON.parse(r) }; } catch {}
  return { ...DEFAULT_COLS };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sourceDomain(url: string | null | undefined): string {
  if (!url) return 'Local';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Local'; }
}

const GRADIENT_FALLBACK = 'radial-gradient(ellipse at 35% 35%, var(--bg-5) 0%, var(--bg-2) 100%)';

// ── Props ─────────────────────────────────────────────────────────────────────

interface LibraryViewProps {
  artworkUrls:               Record<string, string>;
  onOpenInEditor:            (hash: string) => void;
  onTracksChanged:           (tracks: Track[]) => void;
  onTracksAddedToPlaylist?:  (playlistId: string, branchName: string, count: number) => void;
  defaultPlaylistId?:        string | null;
  defaultBranchName?:        string;
  favorites?:                Set<string>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LibraryView({ artworkUrls, onOpenInEditor, onTracksChanged, onTracksAddedToPlaylist, defaultPlaylistId, defaultBranchName, favorites }: LibraryViewProps): JSX.Element {
  const [records,           setRecords]           = useState<TrackRecord[]>([]);
  const [strayHashes,       setStrayHashes]       = useState<Set<string>>(new Set());
  const [search,            setSearch]            = useState('');
  const [filter,            setFilter]            = useState<Filter>('all');
  const [sortField,         setSortField]         = useState<SortField>(() => loadSort().field);
  const [sortDir,           setSortDir]           = useState<SortDir>(() => loadSort().dir);
  const [colWidths,         setColWidths]         = useState<ColWidths>(loadCols);
  const [selected,          setSelected]          = useState<Set<string>>(new Set());
  const [isDragOver,        setIsDragOver]        = useState(false);
  const [isImporting,       setIsImporting]       = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showBulkEdit,      setShowBulkEdit]      = useState(false);
  const [showDownload,      setShowDownload]      = useState(false);
  const [contextMenu,       setContextMenu]       = useState<{ x: number; y: number; hash: string } | null>(null);
  const [playingHash,       setPlayingHash]       = useState<string | null>(null);

  const lastClickRef = useRef<{ hash: string; idx: number } | null>(null);
  const nowSecs = useMemo(() => Date.now() / 1000, []);
  const COL = buildCOL(colWidths);

  // ── Data loading ──────────────────────────────────────────────────────────

  // onTracksChanged is intentionally omitted from deps: it is a stable callback
  // from DesktopApp and adding it would cause re-registration on every render.
  const load = useCallback(async () => {
    const [recs, stray] = await Promise.all([
      invoke<TrackRecord[]>('library_get_all'),
      invoke<string[]>('library_get_stray_tracks'),
    ]);
    setRecords(recs);
    setStrayHashes(new Set(stray));
    onTracksChanged(recs.map(trackRecordToTrack));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const unsub = listen('download://done', () => load());
    return () => { unsub.then(fn => fn()); };
  }, [load]);

  // ── Persistence ───────────────────────────────────────────────────────────

  useEffect(() => {
    localStorage.setItem(SORT_KEY, JSON.stringify({ field: sortField, dir: sortDir }));
  }, [sortField, sortDir]);

  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  // ── Audio events ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = listen<string | Record<string, unknown>>('audio://event', (e) => {
      const p = e.payload;
      if (p === 'TrackEnded' || (typeof p === 'object' && 'TrackEnded' in p)) setPlayingHash(null);
    });
    return () => { unsub.then(fn => fn()); };
  }, []);

  // ── Context menu dismiss on click outside ─────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close, { capture: true });
    return () => document.removeEventListener('click', close, { capture: true });
  }, [!!contextMenu]);

  // ── Inline playback ───────────────────────────────────────────────────────

  const playTrack = useCallback(async (hash: string) => {
    try {
      await invoke('track_play', { hash });
      setPlayingHash(hash);
    } catch (e) {
      console.error('track_play failed:', e);
    }
  }, []);

  // ── Column resize ─────────────────────────────────────────────────────────

  const resize = useCallback((key: ColKey, delta: number) => {
    setColWidths(w => ({ ...w, [key]: Math.max(60, w[key] + delta) }));
  }, []);

  // ── Sort + filter ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = records;
    if (filter === 'new')        rows = rows.filter(r => r.ingested_at > 0 && (nowSecs - r.ingested_at) < 7 * 86400);
    if (filter === 'stray')      rows = rows.filter(r => strayHashes.has(r.hash));
    if (filter === 'local')      rows = rows.filter(r => !r.source_url);
    if (filter === 'downloaded') rows = rows.filter(r => !!r.source_url);

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.artist.toLowerCase().includes(q) ||
        (r.album ?? '').toLowerCase().includes(q)
      );
    }

    return [...rows].sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [records, strayHashes, search, filter, sortField, sortDir, nowSecs]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (hash: string, idx: number, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shift && lastClickRef.current) {
        const lo = Math.min(lastClickRef.current.idx, idx);
        const hi = Math.max(lastClickRef.current.idx, idx);
        filtered.slice(lo, hi + 1).forEach(r => next.add(r.hash));
      } else {
        next.has(hash) ? next.delete(hash) : next.add(hash);
      }
      return next;
    });
    lastClickRef.current = { hash, idx };
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.hash));
  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(r => n.delete(r.hash)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(r => n.add(r.hash)); return n; });
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  // ── Import ────────────────────────────────────────────────────────────────

  const importFiles = async () => {
    const paths = await open({
      multiple: true,
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'wav', 'm4a', 'aac', 'opus'] }],
    });
    if (!paths) return;
    const arr = Array.isArray(paths) ? paths : [paths];
    if (arr.length === 0) return;
    setIsImporting(true);
    try { await invoke('track_ingest_files', { paths: arr }); await load(); }
    finally { setIsImporting(false); }
  };

  const importFolder = async () => {
    const folder = await open({ directory: true });
    if (!folder || typeof folder !== 'string') return;
    setIsImporting(true);
    try { await invoke('library_import_folder', { folder }); await load(); }
    finally { setIsImporting(false); }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    // Tauri injects `.path` on the web File object; it is not in the browser spec.
    const audioPaths = Array.from(e.dataTransfer.files)
      .filter(f => /\.(mp3|flac|ogg|wav|m4a|aac|opus)$/i.test(f.name))
      .map(f => (f as File & { path?: string }).path ?? '')
      .filter(Boolean);
    if (audioPaths.length === 0) return;
    setIsImporting(true);
    try { await invoke('track_ingest_files', { paths: audioPaths }); await load(); }
    finally { setIsImporting(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    for (const hash of selected) await invoke('library_remove_track', { hash });
    setRecords(r => r.filter(t => !selected.has(t.hash)));
    onTracksChanged(records.filter(t => !selected.has(t.hash)).map(trackRecordToTrack));
    setSelected(new Set());
  };

  // ── Filter chips ──────────────────────────────────────────────────────────

  const FILTER_CHIPS: { key: Filter; label: string }[] = [
    { key: 'all',        label: 'All' },
    { key: 'new',        label: 'NEW' },
    { key: 'stray',      label: 'STRAY' },
    { key: 'local',      label: 'Local' },
    { key: 'downloaded', label: 'Downloaded' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid var(--border-0)',
        background: 'var(--bg-1)', flexShrink: 0,
      }}>
        <IcoMusicLib size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', fontFamily: "'Outfit', sans-serif", letterSpacing: '0.04em' }}>
          Library
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
          {records.length} tracks
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowDownload(true)} style={{ ...importBtnStyle, borderColor: 'var(--accent)', color: 'var(--accent-light)' }}>
          <IcoDownload size={12} /> Download
        </button>
        <button onClick={importFiles} disabled={isImporting} style={importBtnStyle}>
          <FiFilePlus size={12} /> Import Files
        </button>
        <button onClick={importFolder} disabled={isImporting} style={importBtnStyle}>
          <FiFolder size={12} /> Import Folder
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 16px', borderBottom: '1px solid var(--border-0)',
        background: 'var(--bg-1)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <FiSearch size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              paddingLeft: 26, paddingRight: 8, paddingTop: 5, paddingBottom: 5,
              background: 'var(--bg-3)', border: '1px solid var(--border-1)',
              borderRadius: 5, color: 'var(--text-1)', fontSize: 11,
              fontFamily: "'Outfit', sans-serif", width: 180, outline: 'none',
            }}
          />
          {search && (
            <IcoClose size={10} onClick={() => setSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', cursor: 'pointer' }} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {FILTER_CHIPS.map(c => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              style={{
                padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.06em', cursor: 'pointer', border: '1px solid',
                fontFamily: "'JetBrains Mono', monospace",
                background:  filter === c.key ? 'var(--accent-dim)' : 'var(--bg-3)',
                borderColor: filter === c.key ? 'var(--accent)'     : 'var(--border-2)',
                color:       filter === c.key ? 'var(--accent-light)': 'var(--text-3)',
              }}
            >{c.label}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
          {filtered.length !== records.length && `${filtered.length} shown · `}{records.length} total
        </span>
      </div>

      {/* ── Column headers ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: COL,
        padding: '0 14px', height: 28, alignItems: 'center', gap: 8,
        background: 'var(--bg-1)', borderBottom: '1px solid var(--border-0)',
        flexShrink: 0, minWidth: 'max-content',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAll}
            style={{ width: 13, height: 13, cursor: 'pointer', accentColor: 'var(--accent)', margin: 0 }}
          />
        </div>
        <div />
        <SortableHeader field="title"       label="Title"  sortField={sortField} sortDir={sortDir} onSort={handleSort} onResize={d => resize('title',  d)} />
        <SortableHeader field="artist"      label="Artist" sortField={sortField} sortDir={sortDir} onSort={handleSort} onResize={d => resize('artist', d)} />
        <SortableHeader field="album"       label="Album"  sortField={sortField} sortDir={sortDir} onSort={handleSort} onResize={d => resize('album',  d)} />
        {/* Duration — sortable, fixed width, no resize handle */}
        <div
          onClick={() => handleSort('duration_ms')}
          style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
            color: sortField === 'duration_ms' ? 'var(--accent-light)' : 'var(--text-3)',
            cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 3,
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          Dur{sortField === 'duration_ms' && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </div>
        {/* Source — resizable, not sortable */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', overflow: 'visible' }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif" }}>
            Source
          </span>
          <ResizeHandle onResize={d => resize('source', d)} />
        </div>
      </div>

      {/* ── Rows ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
            {records.length === 0
              ? 'No tracks yet — import files or download to get started'
              : 'No tracks match the current filter'}
          </div>
        )}

        {filtered.map((r, idx) => {
          const sel       = selected.has(r.hash);
          const art       = artworkUrls[r.hash];
          const isNew     = r.ingested_at > 0 && (nowSecs - r.ingested_at) < 7 * 86400;
          const isStray   = strayHashes.has(r.hash);
          const source    = sourceDomain(r.source_url);
          const isPlaying = playingHash === r.hash;

          return (
            <div
              key={r.hash}
              onClick={e => toggleSelect(r.hash, idx, e.shiftKey)}
              onDoubleClick={() => playTrack(r.hash)}
              onContextMenu={e => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, hash: r.hash });
                if (!selected.has(r.hash)) setSelected(new Set([r.hash]));
              }}
              style={{
                display: 'grid', gridTemplateColumns: COL,
                padding: '0 14px', height: 34, alignItems: 'center', gap: 8,
                background: sel ? 'var(--accent-dim)' : idx % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)',
                cursor: 'pointer',
                borderLeft: sel ? '2px solid var(--accent)' : isPlaying ? '2px solid var(--accent-light)' : '2px solid transparent',
                transition: 'background 0.1s',
                minWidth: 'max-content',
              }}
              onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
              onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)'; }}
            >
              {/* Checkbox */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="checkbox" checked={sel} onChange={() => {}} onClick={e => e.stopPropagation()}
                  style={{ width: 13, height: 13, cursor: 'pointer', accentColor: 'var(--accent)', pointerEvents: 'none', margin: 0 }}
                />
              </div>

              {/* Thumbnail / playing indicator */}
              <div style={{
                width: 22, height: 22, borderRadius: 3, flexShrink: 0, overflow: 'hidden',
                background: art && !isPlaying ? undefined : GRADIENT_FALLBACK,
                border: '1px solid var(--border-1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isPlaying
                  ? <FiPlay size={10} style={{ color: 'var(--accent-light)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  : art
                    ? <img src={art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : null}
              </div>

              {/* Title + badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <ScrollText
                    text={r.title}
                    style={{ flex: '0 1 auto', minWidth: 0 }}
                    textStyle={{ fontSize: 12, color: sel ? 'var(--text-0)' : isPlaying ? 'var(--accent-light)' : 'var(--text-1)' }}
                  />
                  {favorites?.has(r.hash) && (
                    <FiHeart size={9} style={{ fill: 'currentColor', color: 'var(--accent)', flexShrink: 0 }} />
                  )}
                </div>
                {isNew   && <Badge label="NEW"   accent />}
                {isStray && <Badge label="STRAY" />}
              </div>

              {/* Artist */}
              <ScrollText
                text={r.artist}
                textStyle={{ ...cellStyle, color: sel ? 'var(--text-0)' : 'var(--text-2)' }}
              />

              {/* Album */}
              <ScrollText
                text={r.album ?? '—'}
                textStyle={{ ...cellStyle, color: sel ? 'var(--text-0)' : 'var(--text-2)' }}
              />

              {/* Duration */}
              <span style={{ ...cellStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: sel ? 'var(--text-0)' : 'var(--text-2)' }}>
                {fmtDuration(r.duration_ms)}
              </span>

              {/* Source */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                {source !== 'Local'
                  ? <><IcoDownload size={9} style={{ color: sel ? 'var(--text-0)' : 'var(--accent)', flexShrink: 0 }} /><span style={{ ...cellStyle, fontSize: 10, color: sel ? 'var(--text-0)' : 'var(--text-2)' }}>{source}</span></>
                  : <span style={{ ...cellStyle, fontSize: 10, color: sel ? 'var(--text-0)' : 'var(--text-2)' }}>Local</span>
                }
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderTop: '1px solid var(--border-1)',
          background: 'var(--bg-3)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>
            {selected.size} selected
          </span>
          <div style={{ flex: 1 }} />
          <ActionBtn icon={<FiPlus size={11} />}  label="Add to Playlist" onClick={() => setShowAddToPlaylist(true)} />
          <ActionBtn icon={<FiTag size={11} />}   label="Bulk Edit"       onClick={() => setShowBulkEdit(true)} />
          {selected.size === 1 && (
            <ActionBtn icon={<FiEdit2 size={11} />} label="Open in Editor" onClick={() => onOpenInEditor([...selected][0])} />
          )}
          <DeleteBulkBtn count={selected.size} onDelete={deleteSelected} />
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '2px 4px', borderRadius: 3 }}
          >
            <IcoClose size={11} />
          </button>
        </div>
      )}

      {/* ── Drop overlay ── */}
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 10, pointerEvents: 'none',
        }}>
          <FiFilePlus size={32} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}>
            Drop to import
          </span>
        </div>
      )}

      {/* ── Import spinner ── */}
      {isImporting && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 51,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 13, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>
            Importing…
          </span>
        </div>
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          singleSelected={selected.size === 1}
          onPlay={() => { playTrack(contextMenu.hash); setContextMenu(null); }}
          onAddToPlaylist={() => { setContextMenu(null); setShowAddToPlaylist(true); }}
          onBulkEdit={() => { setContextMenu(null); setShowBulkEdit(true); }}
          onOpenInEditor={() => { setContextMenu(null); onOpenInEditor(contextMenu.hash); }}
          onDelete={() => { setContextMenu(null); deleteSelected(); }}
        />
      )}

      {/* ── Modals ── */}
      {showDownload && <DownloadModal onClose={() => setShowDownload(false)} />}
      {showAddToPlaylist && (
        <AddToPlaylistModal
          count={selected.size}
          hashes={[...selected]}
          onDone={(playlistId, branchName) => {
            setShowAddToPlaylist(false);
            const count = selected.size;
            setSelected(new Set());
            onTracksAddedToPlaylist?.(playlistId, branchName, count);
          }}
          onCancel={() => setShowAddToPlaylist(false)}
          defaultPlaylistId={defaultPlaylistId ?? undefined}
          defaultBranchName={defaultBranchName}
        />
      )}
      {showBulkEdit && (
        <BulkEditPanel
          selected={records.filter(r => selected.has(r.hash))}
          onDone={() => { setShowBulkEdit(false); setSelected(new Set()); load(); }}
          onCancel={() => setShowBulkEdit(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current;
      startX.current = ev.clientX;
      onResize(delta);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute', right: -3, top: 0, bottom: 0, width: 7,
        cursor: 'col-resize', zIndex: 10, userSelect: 'none',
      }}
    />
  );
}

interface SortableHeaderProps {
  field:     SortField;
  label:     string;
  sortField: SortField;
  sortDir:   SortDir;
  onSort:    (f: SortField) => void;
  onResize:  (delta: number) => void;
}

function SortableHeader({ field, label, sortField, sortDir, onSort, onResize }: SortableHeaderProps) {
  const active = sortField === field;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', overflow: 'visible' }}>
      <div
        onClick={() => onSort(field)}
        style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
          color: active ? 'var(--accent-light)' : 'var(--text-3)',
          cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 3,
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {label}{active && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </div>
      <ResizeHandle onResize={onResize} />
    </div>
  );
}

interface ContextMenuProps {
  x: number; y: number;
  singleSelected: boolean;
  onPlay:          () => void;
  onAddToPlaylist: () => void;
  onBulkEdit:      () => void;
  onOpenInEditor:  () => void;
  onDelete:        () => void;
}

function ContextMenu({ x, y, singleSelected, onPlay, onAddToPlaylist, onBulkEdit, onOpenInEditor, onDelete }: ContextMenuProps) {
  return (
    <div
      style={{
        position: 'fixed', top: y, left: x, zIndex: 300,
        background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 6,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)', overflow: 'hidden', minWidth: 170,
        fontFamily: "'Outfit', sans-serif",
      }}
      onClick={e => e.stopPropagation()}
    >
      <MenuItem icon={<FiPlay size={11} />}   label="Play"            onClick={onPlay} />
      <MenuItem icon={<FiPlus size={11} />}   label="Add to Playlist" onClick={onAddToPlaylist} />
      <MenuItem icon={<FiTag size={11} />}    label="Bulk Edit"       onClick={onBulkEdit} />
      {singleSelected && <MenuItem icon={<FiEdit2 size={11} />} label="Open in Editor" onClick={onOpenInEditor} />}
      <div style={{ height: 1, background: 'var(--border-1)', margin: '2px 0' }} />
      <MenuItem icon={<FiTrash2 size={11} />} label="Delete"          onClick={onDelete} danger />
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '7px 14px', border: 'none', background: 'transparent',
        color: danger ? '#f87171' : 'var(--text-1)', fontSize: 12, cursor: 'pointer',
        textAlign: 'left', fontFamily: "'Outfit', sans-serif",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? '#7f1d1d55' : 'var(--bg-4)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}{label}
    </button>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', flexShrink: 0,
      padding: '1px 5px', borderRadius: 3,
      background: accent ? 'var(--accent-dim)' : 'var(--bg-4)',
      color:      accent ? 'var(--accent-light)' : 'var(--text-3)',
      border:     `1px solid ${accent ? 'var(--accent)' : 'var(--border-2)'}`,
      fontFamily: "'JetBrains Mono', monospace",
    }}>{label}</span>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '5px 12px', borderRadius: 5,
      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
      color: 'var(--text-1)', fontSize: 11, cursor: 'pointer',
      fontFamily: "'Outfit', sans-serif",
    }}>
      {icon}{label}
    </button>
  );
}

function DeleteBulkBtn({ count, onDelete }: { count: number; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 2500); return () => clearTimeout(t); }, [armed]);
  return (
    <button
      onClick={() => armed ? onDelete() : setArmed(true)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
        fontFamily: "'Outfit', sans-serif",
        background: armed ? '#7f1d1d' : 'var(--bg-4)',
        border:     `1px solid ${armed ? '#f87171' : 'var(--border-2)'}`,
        color:      armed ? '#fca5a5' : 'var(--text-2)',
        transition: 'all 0.15s',
      }}
    >
      <FiTrash2 size={11} />
      {armed ? `Confirm delete ${count}` : `Delete ${count}`}
    </button>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cellStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-2)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const importBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', borderRadius: 5,
  background: 'var(--bg-3)', border: '1px solid var(--border-2)',
  color: 'var(--text-1)', fontSize: 11, cursor: 'pointer',
  fontFamily: "'Outfit', sans-serif",
};
