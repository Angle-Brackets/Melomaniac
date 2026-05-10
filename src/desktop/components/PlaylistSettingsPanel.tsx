import { useState, useEffect } from 'react';
import type { PlaylistRecord } from '../data';

interface Props {
  playlist:           PlaylistRecord | null;
  onDelete?:          () => void;
  onRename?:          (newName: string) => void;
  onSetDescription?:  (desc: string | null) => void;
}

export default function PlaylistSettingsPanel({ playlist, onDelete, onRename, onSetDescription }: Props) {
  const branch = playlist?.branches[0];
  const [name,          setName]          = useState(playlist?.name ?? '');
  const [description,   setDescription]   = useState(playlist?.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync local state when the playlist prop changes (e.g. selecting a different playlist)
  useEffect(() => {
    setName(playlist?.name ?? '');
    setDescription(playlist?.description ?? '');
    setConfirmDelete(false);
  }, [playlist?.id]);

  const nameChanged = name.trim() !== (playlist?.name ?? '').trim() && name.trim().length > 0;
  const descChanged = description.trim() !== (playlist?.description ?? '').trim();

  const saveDescription = () => {
    if (!descChanged) return;
    onSetDescription?.(description.trim() || null);
  };

  return (
    <div className="flex-1 px-6 py-[18px] overflow-y-auto styled-scroll">
      <div style={{ maxWidth: 500 }}>
        <div className="text-[10px] font-bold tracking-widest text-mm-t2 uppercase mb-2.5">Playlist Settings</div>

        {/* Name */}
        <div className="flex items-center justify-between py-2 border-b border-mm-b0 gap-3">
          <span className="text-[12px] text-mm-t2 shrink-0">Name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && nameChanged) onRename?.(name.trim()); }}
            className="input input-xs bg-mm-3 text-mm-t0 flex-1 text-right font-['Outfit']"
            style={{ maxWidth: 280 }}
          />
        </div>

        {/* Description */}
        <div className="py-2 border-b border-mm-b0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-mm-t2">Description</span>
            {descChanged && (
              <button
                className="btn btn-xs border border-mm-accent-dim bg-mm-5 text-mm-accent-lit"
                onClick={saveDescription}
              >
                Save
              </button>
            )}
          </div>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey && descChanged) saveDescription(); }}
            placeholder="A short description of this playlist…"
            rows={3}
            className="textarea textarea-xs w-full bg-mm-3 text-mm-t0 font-['Outfit'] resize-none text-[12px] leading-relaxed"
            style={{ minHeight: 64 }}
          />
          <div className="text-[10px] text-mm-t3 mt-0.5">⌘↵ to save</div>
        </div>

        {([
          ['Branches',    `${playlist?.branches.length ?? 0}`],
          ['Branch',      branch?.name ?? 'main'],
          ['Last commit', branch?.head_commit?.slice(0, 7) ?? '—'],
          ['Forked from', playlist?.forked_from ? playlist.forked_from.slice(0, 8) + '…' : '—'],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2 border-b border-mm-b0">
            <span className="text-[12px] text-mm-t2">{k}</span>
            <span className={`text-[12px] text-mm-t0 ${k === 'Last commit' ? 'font-mono' : ''}`}>{v}</span>
          </div>
        ))}

        <div className="flex gap-2 mt-4">
          {nameChanged && (
            <button
              className="btn btn-sm border border-mm-accent-dim bg-mm-5 text-mm-accent-lit"
              onClick={() => onRename?.(name.trim())}
            >
              Save name
            </button>
          )}
          <div className="flex-1" />
          {confirmDelete ? (
            <>
              <span className="text-[11px] text-error self-center">Delete permanently?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-sm btn-error" onClick={onDelete}>Delete</button>
            </>
          ) : (
            <button
              className="btn btn-ghost btn-sm text-error"
              onClick={() => setConfirmDelete(true)}
              disabled={!playlist}
            >
              Delete Playlist
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
