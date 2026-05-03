import { useState } from 'react';
import { COMMITS, BRANCH_COLORS } from '../data';

interface BranchModalProps {
  onClose: () => void;
  onCreateBranch: (name: string, fromHash: string) => void;
}

export default function BranchModal({ onClose, onCreateBranch }: BranchModalProps) {
  const [branchName, setBranchName] = useState('');
  const [fromCommit, setFromCommit] = useState(COMMITS[0].hash);

  const handleCreate = () => {
    if (!branchName.trim()) return;
    onCreateBranch(branchName.trim(), fromCommit);
    onClose();
  };

  return (
    <dialog className="modal modal-open" style={{ zIndex: 70 }}>
      <div className="modal-box bg-mm-1 border border-mm-b2 max-w-lg p-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-mm-b1 bg-mm-0">
          <div>
            <h3 className="font-bold text-sm text-mm-t0">Create New Branch</h3>
            <p className="font-mono text-[10px] text-mm-t2 mt-0.5">Branches create independent playlist versions</p>
          </div>
          <button className="btn btn-ghost btn-xs btn-square" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Branch name input */}
          <div>
            <label className="block text-[11px] font-semibold text-mm-t1 mb-1.5">Branch name</label>
            <div className="flex">
              <span className="flex items-center px-2.5 bg-mm-3 border border-r-0 border-mm-b1 rounded-l font-mono text-[11px] text-mm-t2 whitespace-nowrap">
                study-beats/
              </span>
              <input
                value={branchName}
                onChange={e => setBranchName(e.target.value.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase())}
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
            <div className="border border-mm-b1 rounded-lg overflow-hidden max-h-56 overflow-y-auto styled-scroll">
              {COMMITS.map(c => {
                const isSelected = fromCommit === c.hash;
                const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
                return (
                  <div key={c.hash}
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
                        <span className="font-mono text-[10px] px-1 rounded-sm"
                          style={{ color, background: color + '18' }}>{c.hash}</span>
                        <span className="font-mono text-[9px] px-1 rounded-sm bg-mm-4 text-mm-t2">{c.branch}</span>
                        {c.tags.map(t => (
                          <span key={t} className="font-mono text-[9px] px-1 rounded-sm"
                            style={{
                              background: t === 'HEAD' ? 'var(--accent-dim)' : 'var(--bg-5)',
                              color: t === 'HEAD' ? 'var(--accent-light)' : 'var(--text-2)',
                            }}>{t}</span>
                        ))}
                        <span className="font-mono text-[10px] text-mm-t2 ml-auto">{c.time}</span>
                      </div>
                      <p className="text-[11px] truncate" style={{ color: isSelected ? 'var(--text-0)' : 'var(--text-1)' }}>
                        {c.msg}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!branchName.trim()}
              className="btn btn-primary btn-sm"
            >⎇ Create Branch</button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={onClose} />
    </dialog>
  );
}
