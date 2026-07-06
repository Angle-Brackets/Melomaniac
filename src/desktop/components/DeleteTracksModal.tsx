import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IcoClose } from '../icons';
import { FiAlertTriangle } from 'react-icons/fi';

interface PlaylistImpact {
  playlist_id:   string;
  playlist_name: string;
  branch_count:  number;
}

interface Props {
  hashes:   string[];
  onCancel: () => void;
  onConfirm: (cascade: boolean) => void;
}

// Confirms a library deletion and previews (via a read-only backend scan) how
// many playlists reference the tracks being deleted, so the user can opt into
// also stripping those playlist entries rather than leaving dead references.
export default function DeleteTracksModal({ hashes, onCancel, onConfirm }: Props) {
  const [impacts,   setImpacts]   = useState<PlaylistImpact[] | null>(null);
  const [cascade,   setCascade]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<PlaylistImpact[]>('playlists_containing_tracks', { hashes })
      .then(res => { if (alive) setImpacts(res); })
      .catch(() => { if (alive) setImpacts([]); });
    return () => { alive = false; };
  }, [hashes]);

  const count = hashes.length;
  const playlistCount = impacts?.length ?? 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget && !deleting) onCancel(); }}>
      <div style={{
        width: 420, background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 10,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
            Delete {count} track{count !== 1 ? 's' : ''} from library
          </span>
          <button onClick={onCancel} disabled={deleting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={13} />
          </button>
        </div>

        <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          The audio file stays on disk, but the library entry {count !== 1 ? 'these tracks use' : 'this track uses'} is removed.
        </span>

        {impacts === null && (
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontStyle: 'italic' }}>Checking playlists…</span>
        )}

        {impacts !== null && playlistCount > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: 12, borderRadius: 7, background: 'var(--bg-2)', border: '1px solid var(--border-1)',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <FiAlertTriangle size={14} style={{ color: '#f0b04a', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5 }}>
                Also in <strong>{playlistCount}</strong> playlist{playlistCount !== 1 ? 's' : ''}:{' '}
                <span style={{ color: 'var(--text-2)' }}>
                  {impacts.map(i => i.playlist_name).join(', ')}
                </span>
              </span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-1)', cursor: 'pointer' }}>
              <input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} />
              Also remove {count !== 1 ? 'these tracks' : 'it'} from {playlistCount === 1 ? 'that playlist' : 'those playlists'}
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
              {cascade
                ? `Leaving ${playlistCount === 1 ? 'the playlist' : 'those playlists'} still won't delete the audio file itself — just its entry there.`
                : `Leaving this unchecked keeps ${count !== 1 ? 'these tracks' : 'it'} playable in ${playlistCount === 1 ? 'that playlist' : 'those playlists'} — the audio file is never deleted from storage, only unlisted from your library.`}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={deleting} style={BTN_GHOST}>Cancel</button>
          <button
            onClick={async () => { setDeleting(true); await onConfirm(cascade); }}
            disabled={deleting || impacts === null}
            style={{ ...BTN_DANGER, opacity: (deleting || impacts === null) ? 0.5 : 1, cursor: (deleting || impacts === null) ? 'not-allowed' : 'pointer' }}
          >
            {deleting ? 'Deleting…' : `Delete ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const BTN_GHOST: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
};

const BTN_DANGER: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 5, fontSize: 12, fontWeight: 600,
  background: '#7f1d1d', border: '1px solid #f87171',
  color: '#fca5a5', fontFamily: "'Outfit', sans-serif",
};
