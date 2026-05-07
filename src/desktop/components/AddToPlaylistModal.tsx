import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord } from '../../store/types';
import { IcoClose } from '../icons';

interface Props {
  count:    number;
  hashes:   string[];
  onDone:   () => void;
  onCancel: () => void;
}

interface PlaylistWithBranches extends PlaylistRecord {
  branches: PlaylistRecord['branches'];
}

export default function AddToPlaylistModal({ count, hashes, onDone, onCancel }: Props) {
  const [playlists,     setPlaylists]     = useState<PlaylistWithBranches[]>([]);
  const [selectedPl,    setSelectedPl]    = useState<string | null>(null);
  const [selectedBr,    setSelectedBr]    = useState<string>('main');
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    invoke<PlaylistWithBranches[]>('playlist_get_all').then(pl => {
      setPlaylists(pl);
      if (pl.length > 0) setSelectedPl(pl[0].id);
    }).catch(() => setError('Failed to load playlists'));
  }, []);

  const activePl = playlists.find(p => p.id === selectedPl);

  const handleSubmit = async () => {
    if (!selectedPl) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await invoke('branch_append_tracks', {
        playlistId: selectedPl,
        branchName: selectedBr,
        hashes,
      });
      onDone();
    } catch (e) {
      setError(String(e));
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{
        width: 400, background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 10,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
            Add {count} track{count !== 1 ? 's' : ''} to playlist
          </span>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={13} />
          </button>
        </div>

        {/* Playlist picker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={LABEL}>Playlist</label>
          {playlists.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>No playlists yet</span>
          ) : (
            <select
              value={selectedPl ?? ''}
              onChange={e => { setSelectedPl(e.target.value); setSelectedBr('main'); }}
              style={SELECT}
            >
              {playlists.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Branch picker */}
        {activePl && activePl.branches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={LABEL}>Branch</label>
            <select
              value={selectedBr}
              onChange={e => setSelectedBr(e.target.value)}
              style={SELECT}
            >
              {activePl.branches.map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <span style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{error}</span>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={BTN_GHOST}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!selectedPl || isSubmitting || playlists.length === 0}
            style={{ ...BTN_PRIMARY, opacity: (!selectedPl || isSubmitting) ? 0.5 : 1, cursor: (!selectedPl || isSubmitting) ? 'not-allowed' : 'pointer' }}
          >
            {isSubmitting ? 'Adding…' : `Add to ${activePl?.name ?? 'playlist'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  fontFamily: "'Outfit', sans-serif",
};

const SELECT: React.CSSProperties = {
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  borderRadius: 5, color: 'var(--text-1)', fontSize: 12,
  padding: '6px 10px', outline: 'none', cursor: 'pointer',
  fontFamily: "'Outfit', sans-serif",
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
