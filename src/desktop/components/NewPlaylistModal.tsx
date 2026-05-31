import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord } from '../data';

interface Props {
  onClose:  () => void;
  onCreate: (playlist: PlaylistRecord) => void;
}

export default function NewPlaylistModal({ onClose, onCreate }: Props) {
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const playlist = await invoke<PlaylistRecord>('playlist_create', {
        name:        name.trim(),
        description: description.trim() || null,
      });
      onCreate(playlist);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <dialog className="modal modal-open" style={{ zIndex: 60 }}>
      <div className="modal-box bg-mm-1 border border-mm-b2 max-w-sm p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-mm-b1 bg-mm-0">
          <h3 className="font-bold text-sm text-mm-t0">New Playlist</h3>
          <button className="btn btn-ghost btn-xs btn-square" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-mm-t2 mb-1">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onClose(); }}
              placeholder="My Playlist"
              className="input input-bordered input-sm w-full bg-mm-2 text-mm-t0"
            />
          </div>

          <div>
            <label className="block text-xs text-mm-t2 mb-1">Description <span className="text-mm-t3">(optional)</span></label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onClose(); }}
              placeholder="A short description…"
              className="input input-bordered input-sm w-full bg-mm-2 text-mm-t0"
            />
          </div>

          {error && <p className="text-xs text-red-400 font-mono">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={!name.trim() || busy}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
    </dialog>
  );
}
