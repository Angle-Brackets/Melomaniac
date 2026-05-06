import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import type { Track } from '../data';
import ResizeHandle from './ResizeHandle';
import ArtworkModal from './ArtworkModal';
import { IcoEditor, IcoDownload, IcoClose, IcoLibrary } from '../icons';
import { FiSave, FiRotateCcw, FiPlusSquare, FiFolder, FiSearch, FiEdit2 } from 'react-icons/fi';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AudioMetadata {
  title:        string | null;
  artist:       string | null;
  album:        string | null;
  album_artist: string | null;
  year:         number | null;
  track_number: number | null;
  track_total:  number | null;
  disc_number:  number | null;
  disc_total:   number | null;
  genre:        string | null;
  composer:     string | null;
  comment:      string | null;
  lyrics:       string | null;
  bpm:          number | null;
  copyright:    string | null;
  duration_ms:  number;
  format:       string;
  file_size:    number | null;
}

interface FileEntry {
  path:        string;
  filename:    string;
  format:      string;
  size_bytes:  number;
  title:       string | null;
  artist:      string | null;
  album:       string | null;
  duration_ms: number;
}

interface MetaForm {
  title:        string;
  artist:       string;
  album:        string;
  album_artist: string;
  year:         string;
  track_number: string;
  track_total:  string;
  disc_number:  string;
  disc_total:   string;
  genre:        string;
  composer:     string;
  comment:      string;
  lyrics:       string;
  bpm:          string;
  copyright:    string;
}

export interface TrackPatch {
  title:  string;
  artist: string;
  album:  string;
}

export interface EditorViewProps {
  track?:             Track;
  tracks?:            Track[];
  artworkUrls?:       Record<string, string>;
  onTrackUpdated?:    (oldHash: string, newHash: string, patch: TrackPatch) => void;
  onArtworkUpdated?:  (affectedHashes: string[], newUrl: string) => void;
}

type BottomTab  = 'library' | 'filesystem' | 'download';
type DownloadFmt = 'flac' | 'mp3' | 'ogg';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_FORM: MetaForm = {
  title: '', artist: '', album: '', album_artist: '',
  year: '', track_number: '', track_total: '',
  disc_number: '', disc_total: '',
  genre: '', composer: '', comment: '', lyrics: '', bpm: '', copyright: '',
};

function metaToForm(m: AudioMetadata): MetaForm {
  return {
    title:        m.title        ?? '',
    artist:       m.artist       ?? '',
    album:        m.album        ?? '',
    album_artist: m.album_artist ?? '',
    year:         m.year         != null ? String(m.year)         : '',
    track_number: m.track_number != null ? String(m.track_number) : '',
    track_total:  m.track_total  != null ? String(m.track_total)  : '',
    disc_number:  m.disc_number  != null ? String(m.disc_number)  : '',
    disc_total:   m.disc_total   != null ? String(m.disc_total)   : '',
    genre:        m.genre        ?? '',
    composer:     m.composer     ?? '',
    comment:      m.comment      ?? '',
    lyrics:       m.lyrics       ?? '',
    bpm:          m.bpm          != null ? String(m.bpm) : '',
    copyright:    m.copyright    ?? '',
  };
}

function formToMeta(f: MetaForm, base: AudioMetadata): AudioMetadata {
  return {
    ...base,
    title:        f.title        || null,
    artist:       f.artist       || null,
    album:        f.album        || null,
    album_artist: f.album_artist || null,
    year:         f.year         ? parseInt(f.year,         10) : null,
    track_number: f.track_number ? parseInt(f.track_number, 10) : null,
    track_total:  f.track_total  ? parseInt(f.track_total,  10) : null,
    disc_number:  f.disc_number  ? parseInt(f.disc_number,  10) : null,
    disc_total:   f.disc_total   ? parseInt(f.disc_total,   10) : null,
    genre:        f.genre        || null,
    composer:     f.composer     || null,
    comment:      f.comment      || null,
    lyrics:       f.lyrics       || null,
    bpm:          f.bpm          ? parseInt(f.bpm, 10) : null,
    copyright:    f.copyright    || null,
  };
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function detectSource(url: string): { label: string; color: string } | null {
  if (!url) return null;
  if (/youtube\.com|youtu\.be/i.test(url))  return { label: 'YouTube',    color: '#ff4040' };
  if (/soundcloud\.com/i.test(url))         return { label: 'SoundCloud', color: '#f76e30' };
  if (/bandcamp\.com/i.test(url))           return { label: 'Bandcamp',   color: '#1da0c3' };
  if (/spotify\.com/i.test(url))            return { label: 'Spotify',    color: '#1db954' };
  if (/^https?:\/\//i.test(url))            return { label: 'URL',        color: 'var(--text-2)' };
  return null;
}

// ── Design tokens (shared between sub-components) ─────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-1)',
  border: '1px solid var(--border-1)',
  borderRadius: 5,
  padding: '6px 9px',
  fontSize: 12,
  color: 'var(--text-0)',
  fontFamily: "'Outfit', sans-serif",
  outline: 'none',
  width: '100%',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-2)',
  fontFamily: "'Outfit', sans-serif",
  fontWeight: 500,
  marginBottom: 4,
  display: 'block',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-3)',
      border: '1px solid var(--border-1)',
      borderRadius: 8,
      padding: '10px 14px 14px',
    }}>
      <span style={{
        display: 'block',
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--text-3)',
        fontFamily: "'Outfit', sans-serif",
        marginBottom: 10,
      }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function FieldInput({
  label, value, onChange, placeholder, mono = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...INPUT_STYLE, fontFamily: mono ? "'JetBrains Mono', monospace" : "'Outfit', sans-serif" }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
        onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
      />
    </div>
  );
}

function SmallBtn({
  icon, label, onClick, accent = false, disabled = false,
}: {
  icon?: ReactNode; label: string; onClick: () => void;
  accent?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 11px',
        background: accent ? 'var(--accent-dim)' : 'var(--bg-4)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-2)'}`,
        borderRadius: 5,
        fontSize: 12,
        color: accent ? 'var(--accent-light)' : 'var(--text-1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontFamily: "'Outfit', sans-serif",
        fontWeight: 500,
        flexShrink: 0,
        transition: 'background 0.12s, opacity 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = accent ? 'var(--accent)' : 'var(--bg-5)'; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = accent ? 'var(--accent-dim)' : 'var(--bg-4)'; }}
    >
      {icon}{label}
    </button>
  );
}

function FormatBadge({ fmt }: { fmt: string }) {
  const short = fmt.replace(/Mpeg/i, 'MP3').replace(/Vorbis/i, 'OGG')
    .replace(/Flac/i, 'FLAC').replace(/Mp4/i, 'M4A')
    .replace(/Opus/i, 'OPUS').replace(/Wav/i, 'WAV')
    .replace(/Aiff/i, 'AIFF').slice(0, 5).toUpperCase();
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
      fontSize: 10, color: 'var(--accent-light)',
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.04em', fontWeight: 700,
    }}>
      {short}
    </span>
  );
}

function LibBadge() {
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
      fontSize: 10, color: 'var(--accent-light)',
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.06em', fontWeight: 700,
    }}>
      LIBRARY
    </span>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '0 15px', height: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--text-0)' : 'var(--text-2)',
        fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: 'pointer', flexShrink: 0,
        fontFamily: "'Outfit', sans-serif",
        transition: 'color 0.12s',
      }}
    >
      {children}
    </button>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{
      padding: '7px 14px', borderBottom: '1px solid var(--border-0)',
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      background: 'var(--bg-1)',
    }}>
      <FiSearch size={13} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        style={{
          flex: 1, background: 'transparent', border: 'none',
          fontSize: 12, color: 'var(--text-1)', outline: 'none',
          fontFamily: "'Outfit', sans-serif",
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 0 }}
        >
          <IcoClose size={12} />
        </button>
      )}
    </div>
  );
}

function ColHeaders({ cols }: { cols: { label: string; width: string | number }[] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols.map(c => typeof c.width === 'number' ? `${c.width}px` : c.width).join(' '),
      padding: '0 14px', height: 28, flexShrink: 0,
      borderBottom: '1px solid var(--border-0)',
      background: 'var(--bg-0)',
      alignItems: 'center', gap: 8,
    }}>
      {cols.map((c, i) => (
        <span key={i} style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif", fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{c.label}</span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EditorView({
  track, tracks = [], artworkUrls = {}, onTrackUpdated, onArtworkUpdated,
}: EditorViewProps) {

  // ── Metadata editor state
  const [loadedPath,   setLoadedPath]   = useState<string | null>(null);
  const [loadedHash,   setLoadedHash]   = useState<string | null>(null);
  const [baseMeta,     setBaseMeta]     = useState<AudioMetadata | null>(null);
  const [form,         setForm]         = useState<MetaForm>(EMPTY_FORM);
  const [originalForm, setOriginalForm] = useState<MetaForm>(EMPTY_FORM);
  const [isDirty,      setIsDirty]      = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  // ── Artwork modal
  const [artworkModalOpen, setArtworkModalOpen] = useState(false);
  const [artHover,         setArtHover]         = useState(false);

  // ── Layout — bottom pane collapses to tab-bar only by default
  const [bottomTab,      setBottomTab]      = useState<BottomTab>('library');
  const [bottomExpanded, setBottomExpanded] = useState(false);
  const [bottomH,        setBottomH]        = useState(240);
  // Tracks whether we've done the first filesystem scan so we only fire once
  const hasScannedFsRef = useRef(false);
  // Counter to detect stale async metadata loads — each new load call gets a unique id
  const loadIdRef = useRef(0);

  // ── Library tab search
  const [libSearch, setLibSearch] = useState('');

  // ── Filesystem tab
  const [scanPath,    setScanPath]    = useState('');
  const [pathInput,   setPathInput]   = useState('');
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isScanning,  setIsScanning]  = useState(false);
  const [scanError,   setScanError]   = useState<string | null>(null);
  const [fsSearch,    setFsSearch]    = useState('');

  // ── Download
  const [dlUrl, setDlUrl] = useState('');
  const [dlFmt, setDlFmt] = useState<DownloadFmt>('mp3');
  const source = detectSource(dlUrl);

  // ── Resolve home dir on mount, initialise filesystem path ───────────────
  useEffect(() => {
    homeDir()
      .then(home => {
        const h = home.replace(/\/$/, '');
        setScanPath(h);
        setPathInput(h);
      })
      .catch(() => {
        setScanPath('/home');
        setPathInput('/home');
      });
  }, []);

  // ── Auto-scan filesystem on first open of that tab ───────────────────────
  useEffect(() => {
    if (bottomTab === 'filesystem' && !hasScannedFsRef.current && scanPath) {
      hasScannedFsRef.current = true;
      scanDir(scanPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, scanPath]);

  // ── Auto-load when the track prop changes ────────────────────────────────
  useEffect(() => {
    if (!track?.hash) return;
    loadFromHash(track.hash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.hash]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  // prefill: optional Track for instant badge + basic fields before the invoke resolves
  const loadFromHash = useCallback(async (hash: string) => {
    if (!hash) return;
    const myId = ++loadIdRef.current;
    // Set the badge immediately — header falls back to currentTrack while the invoke is in-flight
    setLoadedHash(hash);
    setLoadedPath(null);
    setIsDirty(false);
    try {
      const meta = await invoke<AudioMetadata>('library_read_metadata', { hash });
      if (loadIdRef.current !== myId) return; // superseded by a newer load
      const f = metaToForm(meta);
      setBaseMeta(meta);
      setForm(f);
      setOriginalForm(f);
    } catch (err) {
      if (loadIdRef.current === myId) console.error('library_read_metadata failed:', err);
    }
  }, []);

  const loadFromPath = useCallback(async (path: string) => {
    const myId = ++loadIdRef.current;
    try {
      const meta = await invoke<AudioMetadata>('file_read_metadata', { path });
      if (loadIdRef.current !== myId) return;
      const f = metaToForm(meta);
      setBaseMeta(meta);
      setForm(f);
      setOriginalForm(f);
      setLoadedPath(path);
      setLoadedHash(null);
      setIsDirty(false);
    } catch (err) {
      if (loadIdRef.current === myId) console.error('file_read_metadata failed:', err);
    }
  }, []);

  const scanDir = useCallback(async (path: string) => {
    if (!path) return;
    setIsScanning(true);
    setScanError(null);
    try {
      const entries = await invoke<FileEntry[]>('file_scan_directory', { path });
      setFileEntries(entries);
      setScanPath(path);
      setPathInput(path);
    } catch (e) {
      setFileEntries([]);
      setScanError(String(e));
    } finally {
      setIsScanning(false);
    }
  }, []);

  const setField = (key: keyof MetaForm, val: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: val };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(originalForm));
      return next;
    });
  };

  const handleSave = async () => {
    if (!baseMeta || isSaving) return;
    setIsSaving(true);
    setSaveMsg(null);
    try {
      const meta = formToMeta(form, baseMeta);
      if (loadedHash) {
        const newHash = await invoke<string>('library_edit_track', { hash: loadedHash, metadata: meta });
        onTrackUpdated?.(loadedHash, newHash, {
          title:  form.title  || loadedHash,
          artist: form.artist || '—',
          album:  form.album  || 'Unknown Album',
        });
        setLoadedHash(newHash);
        const refreshed = await invoke<AudioMetadata>('library_read_metadata', { hash: newHash });
        setBaseMeta(refreshed);
        setOriginalForm(metaToForm(refreshed));
      } else if (loadedPath) {
        await invoke('file_write_metadata', { path: loadedPath, metadata: meta });
        const refreshed = await invoke<AudioMetadata>('file_read_metadata', { path: loadedPath });
        setBaseMeta(refreshed);
        setOriginalForm(metaToForm(refreshed));
      }
      setIsDirty(false);
      setSaveMsg({ ok: true, text: 'Saved' });
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: String(e) });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  };

  const handleRevert = () => { setForm(originalForm); setIsDirty(false); };

  const handleIngest = async () => {
    if (!loadedPath) return;
    try {
      await invoke('track_ingest_files', { paths: [loadedPath] });
      setSaveMsg({ ok: true, text: 'Ingested into library' });
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: String(e) });
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const artworkUrl    = loadedHash ? (artworkUrls[loadedHash] ?? null) : null;
  const isLibTrack    = !!loadedHash;
  const currentTrack  = loadedHash ? tracks.find(t => t.hash === loadedHash) ?? null : null;

  // Header display values: fall back to library DB name / filename when no tag is set in the file
  const displayTitle  = form.title  || currentTrack?.title  || (loadedPath ? (loadedPath.split('/').pop() ?? '') : null);
  const displayArtist = form.artist || currentTrack?.artist || null;
  const displayAlbum  = form.album  || currentTrack?.album  || null;

  const filteredLib = tracks.filter(t => {
    if (!libSearch) return true;
    const q = libSearch.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q);
  });

  const filteredFs = fileEntries.filter(e => {
    if (!fsSearch) return true;
    const q = fsSearch.toLowerCase();
    return (
      e.filename.toLowerCase().includes(q) ||
      (e.title  ?? '').toLowerCase().includes(q) ||
      (e.artist ?? '').toLowerCase().includes(q) ||
      (e.album  ?? '').toLowerCase().includes(q)
    );
  });

  const gradientFallback = 'radial-gradient(ellipse at 35% 35%, var(--bg-5) 0%, var(--bg-2) 100%)';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>

      {/* ── Top pane: metadata editor — takes all remaining space ─────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Header: artwork + track identity + actions ─────────────── */}
        <div style={{
          display: 'flex', gap: 16, padding: '14px 18px 12px',
          borderBottom: '1px solid var(--border-0)',
          alignItems: 'center', flexShrink: 0,
          background: 'var(--bg-1)',
        }}>
          {/* Artwork — click to open artwork editor */}
          <div
            onClick={() => setArtworkModalOpen(true)}
            onMouseEnter={() => setArtHover(true)}
            onMouseLeave={() => setArtHover(false)}
            style={{
              width: 96, height: 96, flexShrink: 0, borderRadius: 10,
              overflow: 'hidden', border: '1px solid var(--border-2)',
              background: artworkUrl ? undefined : gradientFallback,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              position: 'relative', cursor: 'pointer',
            }}
          >
            {artworkUrl && (
              <img src={artworkUrl} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            {/* Pencil overlay on hover */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.52)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: artHover ? 1 : 0,
              transition: 'opacity 0.15s',
              borderRadius: 10,
            }}>
              <FiEdit2 size={22} style={{ color: 'white' }} />
            </div>
          </div>

          {/* Track info + buttons */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {displayTitle ? (
              <>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: 'var(--text-0)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  lineHeight: 1.3,
                }}>
                  {displayTitle}
                </div>
                {(displayArtist || displayAlbum) && (
                  <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.3 }}>
                    {[displayArtist, displayAlbum].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2, flexWrap: 'wrap' }}>
                  {baseMeta && <FormatBadge fmt={baseMeta.format} />}
                  {isLibTrack && <LibBadge />}
                  {baseMeta?.duration_ms ? (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtDuration(baseMeta.duration_ms)}
                    </span>
                  ) : null}
                  {baseMeta?.file_size ? (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtSize(baseMeta.file_size)}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>
                Select a track from the library below, or open a file from your filesystem
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <SmallBtn
                icon={<FiSave size={12} />}
                label={isSaving ? 'Saving…' : isDirty ? 'Save ●' : 'Save'}
                onClick={handleSave}
                accent
                disabled={!isDirty || isSaving || !displayTitle}
              />
              <SmallBtn
                icon={<FiRotateCcw size={12} />}
                label="Revert"
                onClick={handleRevert}
                disabled={!isDirty}
              />
              {loadedPath && (
                <SmallBtn
                  icon={<FiPlusSquare size={12} />}
                  label="Ingest to Library"
                  onClick={handleIngest}
                />
              )}
              {saveMsg && (
                <span style={{
                  fontSize: 11, color: saveMsg.ok ? 'var(--green)' : '#f87171',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {saveMsg.ok ? '✓' : '✗'} {saveMsg.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Field sections ──────────────────────────────────────────── */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 18px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>

          {/* Identity */}
          <SectionCard title="Identity">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              <FieldInput label="Title"        value={form.title}        onChange={v => setField('title',        v)} />
              <FieldInput label="Artist"       value={form.artist}       onChange={v => setField('artist',       v)} />
              <FieldInput label="Album"        value={form.album}        onChange={v => setField('album',        v)} />
              <FieldInput label="Album Artist" value={form.album_artist} onChange={v => setField('album_artist', v)} />
            </div>
          </SectionCard>

          {/* Numbering */}
          <SectionCard title="Numbering">
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 1fr', gap: '10px 14px', alignItems: 'end' }}>
              <FieldInput label="Year"       value={form.year}         onChange={v => setField('year',         v)} mono />
              <FieldInput label="Track"      value={form.track_number} onChange={v => setField('track_number', v)} mono />
              <FieldInput label="of (total)" value={form.track_total}  onChange={v => setField('track_total',  v)} mono />
              <FieldInput label="Disc"       value={form.disc_number}  onChange={v => setField('disc_number',  v)} mono />
              <FieldInput label="of (total)" value={form.disc_total}   onChange={v => setField('disc_total',   v)} mono />
            </div>
          </SectionCard>

          {/* Detail */}
          <SectionCard title="Detail">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: '10px 14px' }}>
                <FieldInput label="Genre"    value={form.genre}    onChange={v => setField('genre',    v)} />
                <FieldInput label="BPM"      value={form.bpm}      onChange={v => setField('bpm',      v)} mono />
                <FieldInput label="Composer" value={form.composer} onChange={v => setField('composer', v)} />
              </div>

              <div>
                <label style={LABEL_STYLE}>Comment</label>
                <input
                  value={form.comment}
                  onChange={e => setField('comment', e.target.value)}
                  style={INPUT_STYLE}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>

              <div>
                <label style={LABEL_STYLE}>Lyrics</label>
                <textarea
                  value={form.lyrics}
                  onChange={e => setField('lyrics', e.target.value)}
                  rows={4}
                  style={{
                    ...INPUT_STYLE,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    resize: 'vertical',
                    lineHeight: 1.6,
                    color: 'var(--text-1)',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Bottom pane — collapses to tab bar only, expands on demand ── */}
      <div style={{
        flexShrink: 0,
        height: bottomExpanded ? bottomH + 37 : 37,
        display: 'flex', flexDirection: 'column',
        borderTop: '1px solid var(--border-0)',
        overflow: 'hidden',
      }}>

        {/* Tab bar + expand/collapse toggle + filesystem path */}
        <div style={{
          display: 'flex', alignItems: 'center',
          background: 'var(--bg-1)',
          flexShrink: 0, height: 37,
        }}>
          <TabBtn active={bottomTab === 'library'}    onClick={() => { setBottomTab('library');    setBottomExpanded(true); }}>
            <IcoLibrary size={12} /> Library
          </TabBtn>
          <TabBtn active={bottomTab === 'filesystem'} onClick={() => { setBottomTab('filesystem'); setBottomExpanded(true); }}>
            <IcoEditor size={12} /> Filesystem
          </TabBtn>
          <TabBtn active={bottomTab === 'download'}   onClick={() => { setBottomTab('download');   setBottomExpanded(true); }}>
            <IcoDownload size={12} /> Download
          </TabBtn>

          {/* Path bar — only visible on Filesystem tab */}
          {bottomTab === 'filesystem' && bottomExpanded && (
            <>
              <div style={{ width: 1, height: 16, background: 'var(--border-1)', margin: '0 8px', flexShrink: 0 }} />
              <form
                onSubmit={e => { e.preventDefault(); scanDir(pathInput); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <input
                  value={pathInput}
                  onChange={e => setPathInput(e.target.value)}
                  style={{
                    flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border-1)',
                    borderRadius: 4, padding: '4px 8px',
                    fontSize: 11, color: 'var(--text-1)',
                    fontFamily: "'JetBrains Mono', monospace", outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
                />
                <button
                  type="submit"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', background: 'var(--bg-4)',
                    border: '1px solid var(--border-2)', borderRadius: 4,
                    fontSize: 11, color: 'var(--text-1)', cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif", flexShrink: 0,
                  }}
                >
                  <FiFolder size={11} /> Browse
                </button>
              </form>
            </>
          )}

          {/* Expand / collapse toggle at far right */}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setBottomExpanded(e => !e)}
            title={bottomExpanded ? 'Collapse' : 'Expand'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 14, padding: '0 12px',
              height: '100%', display: 'flex', alignItems: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-0)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
          >
            {bottomExpanded ? '▾' : '▴'}
          </button>
        </div>

        {/* Resize handle — only when expanded */}
        {bottomExpanded && (
          <ResizeHandle direction="v" onDelta={d => setBottomH(h => Math.max(120, Math.min(640, h - d)))} />
        )}

        {/* ── Tab content — only rendered when expanded ──────────────── */}
        {/* ── LIBRARY TAB ────────────────────────────────────────────── */}
        {bottomExpanded && bottomTab === 'library' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SearchBar value={libSearch} onChange={setLibSearch} placeholder="Search library…" />
            <ColHeaders cols={[
              { label: '',        width: 28 },
              { label: 'Title',   width: '1fr' },
              { label: 'Artist',  width: 150 },
              { label: 'Album',   width: 150 },
              { label: 'Dur',     width: 50 },
            ]} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredLib.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
                  {libSearch ? 'No tracks match your search' : 'No tracks in library yet — ingest some files to get started'}
                </div>
              )}
              {filteredLib.map((t, i) => {
                const isActive = loadedHash === t.hash;
                const thumb = artworkUrls[t.hash];
                return (
                  <div
                    key={t.hash}
                    onClick={() => loadFromHash(t.hash)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 150px 150px 50px',
                      padding: '0 14px', height: 36,
                      alignItems: 'center', gap: 8,
                      background: isActive ? 'var(--bg-4)' : i % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)',
                      cursor: 'pointer',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)'; }}
                  >
                    {/* Thumbnail */}
                    <div style={{
                      width: 22, height: 22, borderRadius: 3, flexShrink: 0, overflow: 'hidden',
                      background: thumb ? undefined : gradientFallback,
                      border: '1px solid var(--border-1)',
                    }}>
                      {thumb && <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <span style={{ fontSize: 12, color: isActive ? 'var(--text-0)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.artist}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.album}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtDuration(t.duration_ms)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── FILESYSTEM TAB ─────────────────────────────────────────── */}
        {bottomExpanded && bottomTab === 'filesystem' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SearchBar value={fsSearch} onChange={setFsSearch} placeholder="Search files…" />
            <ColHeaders cols={[
              { label: '',         width: 28 },
              { label: 'Filename', width: '1fr' },
              { label: 'Format',   width: 60 },
              { label: 'Artist',   width: 130 },
              { label: 'Album',    width: 130 },
              { label: 'Dur',      width: 50 },
              { label: 'Size',     width: 64 },
            ]} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isScanning && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>Scanning…</div>
              )}
              {!isScanning && fileEntries.length === 0 && !fsSearch && (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  {scanError ? (
                    <span style={{ fontSize: 12, color: '#f87171', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', maxWidth: 420 }}>
                      {scanError}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                      No audio files found in {scanPath || 'selected directory'}
                    </span>
                  )}
                  <SmallBtn icon={<FiFolder size={11} />} label="Browse a folder" onClick={() => {
                    const next = pathInput || scanPath;
                    if (next) scanDir(next);
                  }} />
                </div>
              )}
              {!isScanning && filteredFs.length === 0 && fsSearch && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
                  No files match "{fsSearch}"
                </div>
              )}
              {!isScanning && filteredFs.map((entry, i) => {
                const isActive = loadedPath === entry.path;
                return (
                  <div
                    key={entry.path}
                    onClick={() => loadFromPath(entry.path)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 60px 130px 130px 50px 64px',
                      padding: '0 14px', height: 34,
                      alignItems: 'center', gap: 8,
                      background: isActive ? 'var(--bg-4)' : i % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)',
                      cursor: 'pointer',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'var(--bg-2)' : 'var(--bg-1)'; }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: 3, flexShrink: 0,
                      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IcoEditor size={10} style={{ color: 'var(--accent-dim)', opacity: 0.7 }} />
                    </div>
                    <span style={{ fontSize: 11, color: isActive ? 'var(--text-0)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
                      {entry.filename}
                    </span>
                    <div style={{ display: 'flex' }}><FormatBadge fmt={entry.format} /></div>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.artist ?? '—'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.album ?? '—'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtDuration(entry.duration_ms)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtSize(entry.size_bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── DOWNLOAD TAB ───────────────────────────────────────────── */}
        {bottomExpanded && bottomTab === 'download' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
              <label style={LABEL_STYLE}>URL</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  value={dlUrl}
                  onChange={e => setDlUrl(e.target.value)}
                  placeholder="Paste a YouTube, SoundCloud, or Bandcamp URL…"
                  style={{ ...INPUT_STYLE, flex: 1 }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                {source && (
                  <span style={{
                    padding: '5px 12px', borderRadius: 5,
                    background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                    fontSize: 12, color: source.color, flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                  }}>
                    {source.label}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
              <label style={LABEL_STYLE}>Format</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['flac', 'mp3', 'ogg'] as DownloadFmt[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setDlFmt(fmt)}
                    style={{
                      padding: '6px 16px', borderRadius: 5,
                      background: dlFmt === fmt ? 'var(--accent-dim)' : 'var(--bg-3)',
                      border: `1px solid ${dlFmt === fmt ? 'var(--accent)' : 'var(--border-1)'}`,
                      color: dlFmt === fmt ? 'var(--accent-light)' : 'var(--text-2)',
                      fontSize: 12, cursor: 'pointer', fontWeight: dlFmt === fmt ? 600 : 400,
                      fontFamily: "'Outfit', sans-serif",
                    }}
                  >
                    {fmt === 'mp3' ? 'MP3 320k' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {source?.label === 'Spotify' && (
              <div style={{
                padding: '12px 16px', borderRadius: 7, marginBottom: 18,
                background: 'var(--bg-3)', border: '1px solid var(--border-2)',
                fontSize: 12, color: 'var(--text-2)',
              }}>
                <span style={{ color: '#1db954', fontWeight: 600 }}>Spotify</span> requires the librespot bridge — coming in P2.
              </div>
            )}

            <button
              disabled
              title="yt-dlp backend not yet implemented — coming in P1"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '9px 22px', borderRadius: 6,
                background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                color: 'var(--accent-light)', fontSize: 13, fontWeight: 600,
                cursor: 'not-allowed', opacity: 0.5,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              <IcoDownload size={14} /> Download
            </button>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12, fontFamily: "'JetBrains Mono', monospace" }}>
              yt-dlp backend — P1. Completed downloads are auto-ingested into your library.
            </p>
          </div>
        )}

      </div>
    </div>

    {/* ── Artwork modal ─────────────────────────────────────────────────── */}
    {artworkModalOpen && (
      <ArtworkModal
        trackHash={loadedHash ?? undefined}
        trackPath={loadedPath ?? undefined}
        tracks={tracks}
        onSaved={(newUrl, affectedHashes) => {
          setArtworkModalOpen(false);
          const hashes = affectedHashes ?? (loadedHash ? [loadedHash] : []);
          if (hashes.length > 0) onArtworkUpdated?.(hashes, newUrl);
        }}
        onClose={() => setArtworkModalOpen(false)}
      />
    )}
    </>
  );
}
