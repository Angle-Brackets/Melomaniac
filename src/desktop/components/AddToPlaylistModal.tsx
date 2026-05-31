import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord } from '../../store/types';
import { IcoClose } from '../icons';
import { Select } from './Select';

interface Props {
  count:              number;
  hashes:             string[];
  onDone:             (playlistId: string, branchName: string) => void;
  onCancel:           () => void;
  defaultPlaylistId?: string;
  defaultBranchName?: string;
}

export default function AddToPlaylistModal({ count, hashes, onDone, onCancel, defaultPlaylistId, defaultBranchName }: Props) {
  const [playlists,     setPlaylists]     = useState<PlaylistRecord[]>([]);
  const [selectedPl,    setSelectedPl]    = useState<string | null>(null);
  const [selectedBr,    setSelectedBr]    = useState<string>(defaultBranchName ?? 'main');
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    invoke<PlaylistRecord[]>('playlist_get_all').then(pl => {
      setPlaylists(pl);
      const initial = defaultPlaylistId && pl.find(p => p.id === defaultPlaylistId);
      setSelectedPl(initial ? initial.id : (pl[0]?.id ?? null));
      if (initial && defaultBranchName) setSelectedBr(defaultBranchName);
    }).catch(() => setError('Failed to load playlists'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      onDone(selectedPl, selectedBr);
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
            <Select
              value={selectedPl ?? ''}
              options={playlists.map(p => ({ value: p.id, label: p.name }))}
              onChange={v => {
                setSelectedPl(v);
                const pl = playlists.find(p => p.id === v);
                const hasBr = pl?.branches.some(b => b.name === selectedBr);
                if (!hasBr) setSelectedBr('main');
              }}
              minWidth={200}
            />
          )}
        </div>

        {/* Branch picker */}
        {activePl && activePl.branches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={LABEL}>Branch</label>
            <Select
              value={selectedBr}
              options={activePl.branches.map(b => ({ value: b.name, label: b.name }))}
              onChange={setSelectedBr}
              mono
              minWidth={200}
            />
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
