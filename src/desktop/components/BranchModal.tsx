import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CommitRecord {
  hash:      string;
  tree_hash: string;
  timestamp: number;
  device_id: string;
  message:   string | null;
}

interface BranchModalProps {
  playlistId:   string;
  playlistName: string;
  branchName:   string;
  onClose:      () => void;
  onCreate:     (newBranchName: string) => void;
  closing?:     boolean;
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts * 1000;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function BranchModal({ playlistId, playlistName, branchName, onClose, onCreate, closing }: BranchModalProps) {
  const [name,       setName]       = useState('');
  const [fromCommit, setFromCommit] = useState<string | null>(null);
  const [commits,    setCommits]    = useState<CommitRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    invoke<CommitRecord[]>('branch_get_history', { playlistId, branchName, limit: 50 })
      .then(cs => {
        setCommits(cs);
        if (cs.length > 0) setFromCommit(cs[0].hash);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [playlistId, branchName]);

  const slug = playlistName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const handleCreate = async () => {
    if (!name.trim() || !fromCommit) return;
    setBusy(true); setError(null);
    try {
      await invoke('branch_create', {
        playlistId,
        name: name.trim(),
        fromCommit,
      });
      onCreate(name.trim());
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <dialog className={`modal modal-open ${closing ? 'mm-backdrop-exit' : 'mm-backdrop'}`} style={{ zIndex: 70 }}>
      <div className={`modal-box bg-mm-1 border border-mm-b2 max-w-lg p-0 overflow-hidden ${closing ? 'mm-modal-box-exit' : 'mm-modal-box'}`}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-mm-b1 bg-mm-0">
          <div>
            <h3 className="font-bold text-sm text-mm-t0">Create New Branch</h3>
            <p className="font-mono text-[10px] text-mm-t2 mt-0.5">
              Branching from <span style={{ color: 'var(--accent-light)' }}>{branchName}</span>
            </p>
          </div>
          <button className="btn btn-ghost btn-xs btn-square" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Branch name */}
          <div>
            <label className="block text-[11px] font-semibold text-mm-t1 mb-1.5">Branch name</label>
            <div className="flex">
              <span className="flex items-center px-2.5 bg-mm-3 border border-r-0 border-mm-b1 rounded-l font-mono text-[11px] text-mm-t2 whitespace-nowrap">
                {slug}/
              </span>
              <input
                value={name}
                onChange={e => setName(e.target.value.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase())}
                placeholder="feature-name"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                className="input input-sm flex-1 rounded-l-none bg-mm-3 text-mm-t0 font-mono text-[11px]"
                onFocus={e => (e.target.style.borderColor = 'var(--accent-dim)')}
                onBlur={e => (e.target.style.borderColor = '')}
              />
            </div>
          </div>

          {/* Commit picker */}
          <div>
            <label className="block text-[11px] font-semibold text-mm-t1 mb-1.5">Branch from commit</label>
            {loading ? (
              <div className="border border-mm-b1 rounded-lg px-3 py-4 text-[11px] text-mm-t3 font-mono text-center">
                Loading history…
              </div>
            ) : commits.length === 0 ? (
              <div className="border border-mm-b1 rounded-lg px-3 py-4 text-[11px] text-mm-t3 font-mono text-center">
                No commits yet — create the branch from HEAD
              </div>
            ) : (
              <div className="border border-mm-b1 rounded-lg overflow-hidden max-h-56 overflow-y-auto styled-scroll">
                {commits.map((c, i) => {
                  const isSelected = fromCommit === c.hash;
                  return (
                    <div
                      key={c.hash}
                      onClick={() => setFromCommit(c.hash)}
                      className="flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b border-mm-b0 transition-colors"
                      style={{ background: isSelected ? 'var(--bg-5)' : 'transparent' }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      {/* Radio dot */}
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-2)'}`,
                        background: isSelected ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                      }}>
                        {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff' }} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span
                            className="font-mono text-[10px] px-1 rounded-sm"
                            style={{ color: 'var(--accent-light)', background: 'var(--accent-dim)' }}
                          >
                            {c.hash.slice(0, 7)}
                          </span>
                          <span className="font-mono text-[9px] px-1 rounded-sm bg-mm-4 text-mm-t2">
                            {branchName}
                          </span>
                          {i === 0 && (
                            <span className="font-mono text-[9px] px-1 rounded-sm"
                              style={{ background: 'var(--accent-dim)', color: 'var(--accent-light)' }}>
                              HEAD
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-mm-t2 ml-auto">{fmtTime(c.timestamp)}</span>
                        </div>
                        <p className="text-[11px] truncate" style={{ color: isSelected ? 'var(--text-0)' : 'var(--text-1)' }}>
                          {c.message ?? '(no message)'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400 font-mono">✗ {error}</p>}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !fromCommit || busy}
              className="btn btn-primary btn-sm"
            >
              {busy ? 'Creating…' : '⎇ Create Branch'}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
    </dialog>
  );
}
