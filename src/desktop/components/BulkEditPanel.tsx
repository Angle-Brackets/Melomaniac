import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TrackRecord } from '../data';
import { IcoClose } from '../icons';

// Only fields that are meaningful to apply uniformly across a set of tracks.
// Per-track-unique fields (title, track#, disc#, lyrics, bpm, comment) are excluded.
const BULK_FIELDS = [
  { key: 'artist',       label: 'Artist' },
  { key: 'album',        label: 'Album' },
  { key: 'album_artist', label: 'Album Artist' },
  { key: 'year',         label: 'Year' },
  { key: 'genre',        label: 'Genre' },
  { key: 'composer',     label: 'Composer' },
  { key: 'copyright',    label: 'Copyright' },
] as const;

type BulkKey = typeof BULK_FIELDS[number]['key'];
type BulkForm = Record<BulkKey, string>;

interface Props {
  selected: TrackRecord[];
  onDone:   () => void;
  onCancel: () => void;
}

const EMPTY_FORM: BulkForm = {
  artist: '', album: '', album_artist: '', year: '', genre: '', composer: '', copyright: '',
};

export default function BulkEditPanel({ selected, onDone, onCancel }: Props) {
  const [form,         setForm]         = useState<BulkForm>(EMPTY_FORM);
  const [placeholders, setPlaceholders] = useState<Partial<BulkForm>>({});
  const [isApplying,   setIsApplying]   = useState(false);
  const [progress,     setProgress]     = useState(0);
  const [error,        setError]        = useState<string | null>(null);

  // Compute placeholder text: show "(N values)" when tracks differ on a field
  // Note: only 'artist' and 'album' are mapped — other fields always return '' and never show a multi-value hint
  useEffect(() => {
    const ph: Partial<BulkForm> = {};
    for (const { key } of BULK_FIELDS) {
      const vals = new Set(
        selected.map(t => {
          if (key === 'artist') return t.artist;
          if (key === 'album')  return t.album ?? '';
          return '';
        }).filter(Boolean)
      );
      if (vals.size > 1) ph[key] = `(${vals.size} values)`;
    }
    setPlaceholders(ph);
  }, [selected]);

  const set = (key: BulkKey, val: string) => setForm(f => ({ ...f, [key]: val }));

  const handleApply = async () => {
    const changes = BULK_FIELDS.filter(f => form[f.key].trim() !== '');
    if (changes.length === 0) { onCancel(); return; }

    setIsApplying(true);
    setError(null);
    let done = 0;

    for (const track of selected) {
      try {
        // Read current metadata so we preserve fields we're not touching
        const meta = await invoke<Record<string, unknown>>('library_read_metadata', { hash: track.hash });
        const updated = { ...meta };
        for (const { key } of changes) {
          const val = form[key].trim();
          if (key === 'year') updated[key] = val ? parseInt(val, 10) : null;
          else                updated[key] = val || null;
        }
        await invoke('library_edit_track', { hash: track.hash, metadata: updated });
      } catch (e) {
        setError(`Failed on "${track.title}": ${e}`);
        setIsApplying(false);
        return;
      }
      done++;
      setProgress(done / selected.length);
    }

    onDone();
  };

  const changedCount = BULK_FIELDS.filter(f => form[f.key].trim() !== '').length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{
        width: 460, background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 10,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              Bulk Edit Metadata
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 10, fontFamily: "'JetBrains Mono', monospace" }}>
              {selected.length} tracks selected
            </span>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={13} />
          </button>
        </div>

        {/* Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
          {BULK_FIELDS.map(({ key, label }) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={LABEL_STYLE}>{label}</label>
              <input
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholders[key] ?? 'Leave blank to keep existing'}
                style={{
                  ...INPUT_STYLE,
                  color: form[key] ? 'var(--text-0)' : 'var(--text-3)',
                  fontStyle: form[key] ? 'normal' : 'italic',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          ))}
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>
          Empty fields are left untouched. Filled fields overwrite all {selected.length} tracks.
        </p>

        {/* Progress bar */}
        {isApplying && (
          <div style={{ height: 3, background: 'var(--bg-5)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--accent)', borderRadius: 2,
              width: `${progress * 100}%`, transition: 'width 0.2s ease',
            }} />
          </div>
        )}

        {error && (
          <span style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{error}</span>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={isApplying} style={{ ...BTN_GHOST, opacity: isApplying ? 0.5 : 1 }}>Cancel</button>
          <button
            onClick={handleApply}
            disabled={isApplying}
            style={{ ...BTN_PRIMARY, opacity: isApplying ? 0.5 : 1, cursor: isApplying ? 'not-allowed' : 'pointer' }}
          >
            {isApplying
              ? `Applying… ${Math.round(progress * selected.length)}/${selected.length}`
              : changedCount > 0
                ? `Apply ${changedCount} field${changedCount !== 1 ? 's' : ''} to ${selected.length} tracks`
                : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  fontFamily: "'Outfit', sans-serif",
};

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  borderRadius: 5, color: 'var(--text-1)', fontSize: 12,
  padding: '6px 10px', outline: 'none',
  fontFamily: "'Outfit', sans-serif", width: '100%', boxSizing: 'border-box',
};

const BTN_GHOST: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 5, fontSize: 12, fontWeight: 600,
  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
  color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif",
};
