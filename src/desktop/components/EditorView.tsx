import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../data';
import ResizeHandle from './ResizeHandle';
import {
  IcoEditor, IcoDownload, IcoClose,
} from '../icons';
import { FiSave, FiRotateCcw, FiPlusSquare, FiFolder, FiSearch } from 'react-icons/fi';

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
  track?:          Track;
  artworkUrls?:    Record<string, string>;
  onTrackUpdated?: (oldHash: string, newHash: string, patch: TrackPatch) => void;
}

type BottomTab  = 'files' | 'download';
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
    bpm:          m.bpm          != null ? String(m.bpm)          : '',
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
    bpm:          f.bpm          ? parseInt(f.bpm,          10) : null,
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
  if (/bandcamp\.com/i.test(url))           return { label: 'Bandcamp',   color: '#5fa' };
  if (/spotify\.com/i.test(url))            return { label: 'Spotify',    color: '#1db954' };
  if (/^https?:\/\//i.test(url))            return { label: 'URL',        color: 'var(--text-2)' };
  return null;
}

// ── Styled sub-components ─────────────────────────────────────────────────────

function FieldInput({
  label, value, onChange, placeholder, mono = false, wide = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean; wide?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--border-1)',
          borderRadius: 4,
          padding: '4px 7px',
          fontSize: 12,
          color: 'var(--text-0)',
          fontFamily: mono ? "'JetBrains Mono', monospace" : "'Outfit', sans-serif",
          outline: 'none',
          width: '100%',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
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
        padding: '4px 10px',
        background: accent ? 'var(--accent-dim)' : 'var(--bg-4)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-2)'}`,
        borderRadius: 5,
        fontSize: 11, color: accent ? 'var(--accent-light)' : 'var(--text-1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: "'Outfit', sans-serif",
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = accent ? 'var(--accent)' : 'var(--bg-5)'; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = accent ? 'var(--accent-dim)' : 'var(--bg-4)'; }}
    >
      {icon}{label}
    </button>
  );
}

function FormatBadge({ fmt }: { fmt: string }) {
  const short = fmt.replace(/^(Mpeg|Flac|Vorbis|Mp4|Opus|Wav|Aiff|Ape)/i, m => m.toUpperCase()).slice(0, 5);
  return (
    <span style={{
      padding: '1px 5px', borderRadius: 3,
      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
      fontSize: 9, color: 'var(--accent-light)',
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.05em',
    }}>
      {short}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EditorView({ track, artworkUrls = {}, onTrackUpdated }: EditorViewProps) {
  // ── File state
  const [loadedPath,   setLoadedPath]   = useState<string | null>(null);
  const [loadedHash,   setLoadedHash]   = useState<string | null>(null);
  const [baseMeta,     setBaseMeta]     = useState<AudioMetadata | null>(null);
  const [form,         setForm]         = useState<MetaForm>(EMPTY_FORM);
  const [originalForm, setOriginalForm] = useState<MetaForm>(EMPTY_FORM);
  const [isDirty,      setIsDirty]      = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  // ── Layout
  const [topH,       setTopH]       = useState(300);
  const [bottomTab,  setBottomTab]  = useState<BottomTab>('files');

  // ── File browser
  const [scanPath,   setScanPath]   = useState(() => {
    // Start at home dir — Tauri doesn't give us an env on all platforms but JS can infer
    return '/home';
  });
  const [fileEntries,  setFileEntries]  = useState<FileEntry[]>([]);
  const [isScanning,   setIsScanning]   = useState(false);
  const [fileSearch,   setFileSearch]   = useState('');
  const [pathInput,    setPathInput]    = useState('/home');

  // ── Download
  const [dlUrl,    setDlUrl]    = useState('');
  const [dlFmt,    setDlFmt]    = useState<DownloadFmt>('mp3');
  const source = detectSource(dlUrl);

  // ── Auto-load when the track prop changes ────────────────────────────────
  useEffect(() => {
    if (!track?.hash) return;
    loadFromHash(track.hash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.hash]);

  // ── Scan initial dir on mount ────────────────────────────────────────────
  useEffect(() => {
    scanDir('/home');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const loadFromHash = useCallback(async (hash: string) => {
    try {
      const meta = await invoke<AudioMetadata>('library_read_metadata', { hash });
      setBaseMeta(meta);
      const f = metaToForm(meta);
      setForm(f);
      setOriginalForm(f);
      setLoadedHash(hash);
      setLoadedPath(null);
      setIsDirty(false);
    } catch (err) {
      console.error('library_read_metadata failed:', err);
    }
  }, []);

  const loadFromPath = useCallback(async (path: string) => {
    try {
      const meta = await invoke<AudioMetadata>('file_read_metadata', { path });
      setBaseMeta(meta);
      const f = metaToForm(meta);
      setForm(f);
      setOriginalForm(f);
      setLoadedPath(path);
      setLoadedHash(null);
      setIsDirty(false);
    } catch (err) {
      console.error('file_read_metadata failed:', err);
    }
  }, []);

  const scanDir = useCallback(async (path: string) => {
    setIsScanning(true);
    try {
      const entries = await invoke<FileEntry[]>('file_scan_directory', { path });
      setFileEntries(entries);
      setScanPath(path);
      setPathInput(path);
    } catch {
      setFileEntries([]);
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
        // Refresh metadata from the new hash
        const refreshed = await invoke<AudioMetadata>('library_read_metadata', { hash: newHash });
        setBaseMeta(refreshed);
        const f = metaToForm(refreshed);
        setOriginalForm(f);
      } else if (loadedPath) {
        await invoke('file_write_metadata', { path: loadedPath, metadata: meta });
        const refreshed = await invoke<AudioMetadata>('file_read_metadata', { path: loadedPath });
        setBaseMeta(refreshed);
        const f = metaToForm(refreshed);
        setOriginalForm(f);
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

  const handleRevert = () => {
    setForm(originalForm);
    setIsDirty(false);
  };

  // Ingest the currently loaded filesystem file into the CAS library
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
  const artworkUrl  = loadedHash ? (artworkUrls[loadedHash] ?? null) : null;
  const displayName = loadedPath
    ? loadedPath.split('/').pop() ?? loadedPath
    : (loadedHash ? (form.title || loadedHash.slice(0, 12) + '…') : null);

  const filteredFiles = fileEntries.filter(e => {
    if (!fileSearch) return true;
    const q = fileSearch.toLowerCase();
    return (
      e.filename.toLowerCase().includes(q) ||
      (e.title  ?? '').toLowerCase().includes(q) ||
      (e.artist ?? '').toLowerCase().includes(q) ||
      (e.album  ?? '').toLowerCase().includes(q)
    );
  });

  const isLibraryTrack = !!loadedHash;

  // ── Artwork gradient fallback ─────────────────────────────────────────────
  const gradientFallback = 'radial-gradient(ellipse at 40% 40%, var(--bg-5) 0%, var(--bg-2) 100%)';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>

      {/* ── Top pane: metadata editor ──────────────────────────────────── */}
      <div style={{ height: topH, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header row: artwork + file info + buttons */}
        <div style={{
          display: 'flex', gap: 14, padding: '12px 16px 10px',
          borderBottom: '1px solid var(--border-0)',
          alignItems: 'flex-start', flexShrink: 0,
        }}>
          {/* Artwork */}
          <div style={{
            width: 80, height: 80, flexShrink: 0, borderRadius: 8,
            overflow: 'hidden', border: '1px solid var(--border-2)',
            background: artworkUrl ? undefined : gradientFallback,
          }}>
            {artworkUrl && (
              <img src={artworkUrl} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>

          {/* File info + action buttons */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {/* Filename row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {displayName ? (
                <>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--text-0)',
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
                  }}>
                    {displayName}
                  </span>
                  {baseMeta && <FormatBadge fmt={baseMeta.format} />}
                  {isLibraryTrack && (
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                      color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '0.06em',
                    }}>LIBRARY</span>
                  )}
                  {baseMeta?.duration_ms ? (
                    <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
                      {fmtDuration(baseMeta.duration_ms)}
                    </span>
                  ) : null}
                  {baseMeta?.file_size ? (
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                      {fmtSize(baseMeta.file_size)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                  No file loaded — click a file below or select a library track
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <SmallBtn
                icon={<FiSave size={11} />}
                label={isSaving ? 'Saving…' : 'Save'}
                onClick={handleSave}
                accent disabled={!isDirty || isSaving || !displayName}
              />
              <SmallBtn
                icon={<FiRotateCcw size={11} />}
                label="Revert"
                onClick={handleRevert}
                disabled={!isDirty}
              />
              {loadedPath && (
                <SmallBtn
                  icon={<FiPlusSquare size={11} />}
                  label="Ingest to Library"
                  onClick={handleIngest}
                />
              )}
              {saveMsg && (
                <span style={{
                  fontSize: 10, color: saveMsg.ok ? 'var(--green)' : '#f87171',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {saveMsg.ok ? '✓' : '✗'} {saveMsg.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Fields grid */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '10px 16px 10px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {/* Row 1: Title, Artist */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FieldInput label="Title"  value={form.title}  onChange={v => setField('title',  v)} />
            <FieldInput label="Artist" value={form.artist} onChange={v => setField('artist', v)} />
          </div>

          {/* Row 2: Album, Album Artist */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FieldInput label="Album"        value={form.album}        onChange={v => setField('album',        v)} />
            <FieldInput label="Album Artist" value={form.album_artist} onChange={v => setField('album_artist', v)} />
          </div>

          {/* Row 3: Year, Track #, /, Total, Disc #, /, Total */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px 60px 60px 60px 60px', gap: 8 }}>
            <FieldInput label="Year"  value={form.year}         onChange={v => setField('year',  v)} mono />
            <FieldInput label="Track" value={form.track_number} onChange={v => setField('track_number', v)} mono />
            <FieldInput label="/ Total" value={form.track_total} onChange={v => setField('track_total', v)} mono />
            <FieldInput label="Disc"   value={form.disc_number} onChange={v => setField('disc_number',  v)} mono />
            <FieldInput label="/ Total" value={form.disc_total} onChange={v => setField('disc_total',   v)} mono />
          </div>

          {/* Row 4: Genre, BPM, Composer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8 }}>
            <FieldInput label="Genre"    value={form.genre}    onChange={v => setField('genre',    v)} />
            <FieldInput label="BPM"      value={form.bpm}      onChange={v => setField('bpm',      v)} mono />
            <FieldInput label="Composer" value={form.composer} onChange={v => setField('composer', v)} />
          </div>

          {/* Comment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
              Comment
            </label>
            <input
              value={form.comment}
              onChange={e => setField('comment', e.target.value)}
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--border-1)',
                borderRadius: 4, padding: '4px 7px',
                fontSize: 12, color: 'var(--text-0)',
                fontFamily: "'Outfit', sans-serif", outline: 'none', width: '100%',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
            />
          </div>

          {/* Lyrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 70 }}>
            <label style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
              Lyrics
            </label>
            <textarea
              value={form.lyrics}
              onChange={e => setField('lyrics', e.target.value)}
              rows={3}
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--border-1)',
                borderRadius: 4, padding: '5px 7px',
                fontSize: 11, color: 'var(--text-1)',
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none', resize: 'vertical', width: '100%',
                lineHeight: 1.55,
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
            />
          </div>
        </div>
      </div>

      {/* ── Resize handle ─────────────────────────────────────────────── */}
      <ResizeHandle direction="v" onDelta={d => setTopH(h => Math.max(180, Math.min(600, h + d)))} />

      {/* ── Bottom pane: file browser / downloader ─────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

        {/* Tab bar + path */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          borderBottom: '1px solid var(--border-0)',
          background: 'var(--bg-1)',
          flexShrink: 0, height: 34,
        }}>
          {/* Tabs */}
          {(['files', 'download'] as BottomTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setBottomTab(tab)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '0 14px', height: '100%',
                background: bottomTab === tab ? 'var(--bg-2)' : 'transparent',
                border: 'none', borderBottom: bottomTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                color: bottomTab === tab ? 'var(--text-0)' : 'var(--text-2)',
                fontSize: 11, fontWeight: bottomTab === tab ? 600 : 400,
                cursor: 'pointer', flexShrink: 0,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              {tab === 'files' ? <IcoEditor size={11} /> : <IcoDownload size={11} />}
              {tab === 'files' ? 'Files' : 'Download'}
            </button>
          ))}

          {/* Path bar (files tab only) */}
          {bottomTab === 'files' && (
            <>
              <div style={{ width: 1, height: 16, background: 'var(--border-1)', margin: '0 8px' }} />
              <form
                onSubmit={e => { e.preventDefault(); scanDir(pathInput); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10 }}
              >
                <input
                  value={pathInput}
                  onChange={e => setPathInput(e.target.value)}
                  style={{
                    flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border-1)',
                    borderRadius: 4, padding: '3px 7px',
                    fontSize: 11, color: 'var(--text-1)',
                    fontFamily: "'JetBrains Mono', monospace", outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
                />
                <button
                  type="submit"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', background: 'var(--bg-4)',
                    border: '1px solid var(--border-2)', borderRadius: 4,
                    fontSize: 11, color: 'var(--text-1)', cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif",
                  }}
                >
                  <FiFolder size={11} /> Browse
                </button>
              </form>
            </>
          )}
        </div>

        {/* ── FILES TAB ──────────────────────────────────────────────── */}
        {bottomTab === 'files' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Search bar */}
            <div style={{
              padding: '7px 12px', borderBottom: '1px solid var(--border-0)',
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              background: 'var(--bg-1)',
            }}>
              <FiSearch size={12} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
              <input
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                placeholder="Search files…"
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  fontSize: 11, color: 'var(--text-1)', outline: 'none',
                  fontFamily: "'Outfit', sans-serif",
                }}
              />
              {fileSearch && (
                <button
                  onClick={() => setFileSearch('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}
                >
                  <IcoClose size={11} />
                </button>
              )}
            </div>

            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '24px 1fr 52px 130px 130px 52px 62px',
              padding: '0 12px',
              height: 26, flexShrink: 0,
              borderBottom: '1px solid var(--border-0)',
              background: 'var(--bg-0)',
              alignItems: 'center', gap: 6,
            }}>
              {['', 'Filename', 'Format', 'Artist', 'Album', 'Dur', 'Size'].map((h, i) => (
                <span key={i} style={{
                  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em',
                  color: 'var(--text-3)',
                  fontFamily: "'JetBrains Mono', monospace",
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{h}</span>
              ))}
            </div>

            {/* File rows */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isScanning && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>
                  Scanning…
                </div>
              )}
              {!isScanning && filteredFiles.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 11, fontStyle: 'italic' }}>
                  {fileSearch ? 'No files match your search' : `No audio files found in ${scanPath}`}
                </div>
              )}
              {!isScanning && filteredFiles.map((entry, i) => {
                const isActive = loadedPath === entry.path;
                return (
                  <div
                    key={entry.path}
                    onClick={() => loadFromPath(entry.path)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr 52px 130px 130px 52px 62px',
                      padding: '0 12px',
                      height: 32, alignItems: 'center', gap: 6,
                      background: isActive ? 'var(--bg-4)' : i % 2 === 0 ? 'var(--bg-1)' : 'var(--bg-2)',
                      cursor: 'pointer',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'var(--bg-1)' : 'var(--bg-2)'; }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 18, height: 18, borderRadius: 3, flexShrink: 0,
                      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IcoEditor size={9} style={{ color: 'var(--accent-dim)' }} />
                    </div>
                    {/* Filename */}
                    <span style={{
                      fontSize: 11, color: isActive ? 'var(--text-0)' : 'var(--text-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {entry.filename}
                    </span>
                    {/* Format */}
                    <div><FormatBadge fmt={entry.format} /></div>
                    {/* Artist */}
                    <span style={{
                      fontSize: 10, color: 'var(--text-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.artist ?? '—'}
                    </span>
                    {/* Album */}
                    <span style={{
                      fontSize: 10, color: 'var(--text-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.album ?? '—'}
                    </span>
                    {/* Duration */}
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtDuration(entry.duration_ms)}
                    </span>
                    {/* Size */}
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmtSize(entry.size_bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── DOWNLOAD TAB ───────────────────────────────────────────── */}
        {bottomTab === 'download' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
            {/* URL row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
              <label style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                URL
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={dlUrl}
                  onChange={e => setDlUrl(e.target.value)}
                  placeholder="Paste YouTube, SoundCloud, or Bandcamp URL…"
                  style={{
                    flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border-1)',
                    borderRadius: 5, padding: '6px 10px',
                    fontSize: 12, color: 'var(--text-0)',
                    fontFamily: "'Outfit', sans-serif", outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; }}
                />
                {source && (
                  <span style={{
                    padding: '4px 10px', borderRadius: 5,
                    background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                    fontSize: 11, color: source.color, flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {source.label}
                  </span>
                )}
              </div>
            </div>

            {/* Format selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
              <label style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                Format
              </label>
              <div style={{ display: 'flex', gap: 7 }}>
                {(['flac', 'mp3', 'ogg'] as DownloadFmt[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setDlFmt(fmt)}
                    style={{
                      padding: '5px 14px', borderRadius: 5,
                      background: dlFmt === fmt ? 'var(--accent-dim)' : 'var(--bg-3)',
                      border: `1px solid ${dlFmt === fmt ? 'var(--accent)' : 'var(--border-1)'}`,
                      color: dlFmt === fmt ? 'var(--accent-light)' : 'var(--text-2)',
                      fontSize: 11, cursor: 'pointer',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {fmt === 'mp3' ? 'MP3 320k' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Spotify notice */}
            {source?.label === 'Spotify' && (
              <div style={{
                padding: '10px 14px', borderRadius: 6,
                background: 'var(--bg-3)', border: '1px solid var(--border-2)',
                fontSize: 11, color: 'var(--text-2)',
                marginBottom: 14,
              }}>
                <span style={{ color: '#1db954', fontWeight: 600 }}>Spotify</span> requires the librespot bridge — coming in P2.
              </div>
            )}

            {/* Download button */}
            <button
              disabled
              title="yt-dlp backend not yet implemented — coming in P1"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 20px', borderRadius: 6,
                background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                color: 'var(--accent-light)', fontSize: 13, fontWeight: 600,
                cursor: 'not-allowed', opacity: 0.55,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              <IcoDownload size={14} />
              Download
            </button>
            <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 10, fontFamily: "'JetBrains Mono', monospace" }}>
              yt-dlp backend · coming in P1 — on completion, track is auto-ingested into your library
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
