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
    <div style={{
      position: 'absolute', inset: 0, zIndex: 70,
      background: 'rgba(8,5,2,0.82)', backdropFilter: 'blur(5px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, background: 'var(--bg-1)', borderRadius: 10,
        border: '1px solid var(--border-2)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-1)', background: 'var(--bg-0)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Create New Branch</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              Branches create independent playlist versions
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--border-1)', borderRadius: 5,
            color: 'var(--text-2)', fontSize: 11, padding: '2px 9px', cursor: 'pointer',
            fontFamily: "'Outfit', sans-serif",
          }}>✕</button>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
              Branch name
            </label>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{
                padding: '7px 10px', background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                borderRight: 'none', borderRadius: '5px 0 0 5px',
                fontSize: 11, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'nowrap',
              }}>study-beats/</span>
              <input
                value={branchName}
                onChange={e => setBranchName(e.target.value.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase())}
                placeholder="feature-name"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                style={{
                  flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                  borderRadius: '0 5px 5px 0', padding: '7px 10px',
                  fontSize: 11, color: 'var(--text-0)', fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent-dim)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border-1)')}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
              Branch from commit
            </label>
            <div style={{
              border: '1px solid var(--border-1)', borderRadius: 6, overflow: 'hidden',
              maxHeight: 220, overflowY: 'auto',
            }} className="styled-scroll">
              {COMMITS.map(c => {
                const isSelected = fromCommit === c.hash;
                const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
                return (
                  <div key={c.hash} onClick={() => setFromCommit(c.hash)}
                    style={{
                      padding: '9px 12px', cursor: 'pointer',
                      background: isSelected ? 'var(--bg-5)' : 'transparent',
                      borderBottom: '1px solid var(--border-0)',
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-2)'}`,
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color, background: color + '18', padding: '1px 5px', borderRadius: 3 }}>{c.hash}</span>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-4)', color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{c.branch}</span>
                        {c.tags.map(t => (
                          <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: t === 'HEAD' ? 'var(--accent-dim)' : 'var(--bg-5)', color: t === 'HEAD' ? 'var(--accent-light)' : 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{t}</span>
                        ))}
                        <span style={{ fontSize: 10, color: 'var(--text-2)', marginLeft: 'auto' }}>{c.time}</span>
                      </div>
                      <div style={{ fontSize: 11, color: isSelected ? 'var(--text-0)' : 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.msg}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{
              padding: '6px 16px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
              border: '1px solid var(--border-1)', background: 'transparent',
              color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
            }}>Cancel</button>
            <button onClick={handleCreate} disabled={!branchName.trim()} style={{
              padding: '6px 16px', borderRadius: 5, fontSize: 11,
              cursor: branchName.trim() ? 'pointer' : 'not-allowed',
              border: '1px solid var(--accent-dim)', background: 'var(--bg-5)',
              color: branchName.trim() ? 'var(--accent-light)' : 'var(--text-3)',
              fontFamily: "'Outfit', sans-serif", transition: 'all 0.15s',
            }}>⎇ Create Branch</button>
          </div>
        </div>
      </div>
    </div>
  );
}
