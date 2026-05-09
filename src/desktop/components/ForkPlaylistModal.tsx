import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord } from '../data';
import { IcoClose } from '../icons';
import { TbGitFork } from 'react-icons/tb';

interface PlaylistWithBranches extends PlaylistRecord {
  branches: PlaylistRecord['branches'];
}

interface Props {
  source:   PlaylistRecord;
  onForked: (newPlaylist: PlaylistWithBranches) => void;
  onClose:  () => void;
}

export default function ForkPlaylistModal({ source, onForked, onClose }: Props) {
  const [name,        setName]        = useState(`${source.name} (fork)`);
  const [submitting,  setSubmitting]  = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setErr(null);
    try {
      const playlist = await invoke<PlaylistWithBranches>('playlist_fork', {
        sourceId: source.id,
        newName:  trimmed,
      });
      onForked(playlist);
    } catch (e) {
      setErr(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 480, background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 12,
        padding: 30, display: 'flex', flexDirection: 'column', gap: 22,
        boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TbGitFork size={20} style={{ color: 'var(--accent-light)' }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              Fork playlist
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={15} />
          </button>
        </div>

        {/* Source info */}
        <div style={{
          background: 'var(--bg-2)', border: '1px solid var(--border-1)',
          borderRadius: 7, padding: '11px 14px',
          fontSize: 13, color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
        }}>
          Forking <span style={{ color: 'var(--text-0)', fontWeight: 600 }}>{source.name}</span>
          {' '}({source.branches?.length ?? 1} branch{(source.branches?.length ?? 1) !== 1 ? 'es' : ''})
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            The fork starts from the current state. Future changes to either playlist are independent.
          </div>
        </div>

        {/* Name input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={LABEL}>New playlist name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
            style={{
              background: 'var(--bg-2)', border: '1px solid var(--border-1)',
              borderRadius: 6, color: 'var(--text-0)', fontSize: 14,
              padding: '9px 12px', outline: 'none', fontFamily: "'Outfit', sans-serif",
            }}
            onFocus={e => (e.target as HTMLInputElement).select()}
          />
        </div>

        {err && (
          <span style={{ fontSize: 12, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{err}</span>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button onClick={onClose} style={BTN_GHOST}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            style={{ ...BTN_PRIMARY, opacity: (!name.trim() || submitting) ? 0.5 : 1, cursor: (!name.trim() || submitting) ? 'not-allowed' : 'pointer' }}
          >
            <TbGitFork size={14} />
            {submitting ? 'Forking…' : 'Fork'}
          </button>
        </div>
      </div>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  fontFamily: "'Outfit', sans-serif",
};

const BTN_GHOST: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600,
  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
  color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif",
  display: 'flex', alignItems: 'center', gap: 7,
};
