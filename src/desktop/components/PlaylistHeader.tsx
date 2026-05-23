import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord, BranchRecord } from '../data';
import { IcoPin } from '../icons';
import { FiSettings as GearIcon, FiGitBranch, FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import { TbGitFork } from 'react-icons/tb';
import { FiGitMerge } from 'react-icons/fi';

interface PlaylistHeaderProps {
  playlist:      PlaylistRecord | null;
  artworkUrl:    string | null;
  activeBranch:  string;
  onBranchChange:(name: string) => void;
  activeTab:     string;
  onTabChange:   (tab: string) => void;
  isPinned:      boolean;
  onTogglePin:   () => void;
  onNewBranch:   () => void;
  onMerge:       () => void;
  onFork:        () => void;
  onEditArtwork: () => void;
  onBranchesChanged: () => void;
}

const TABS = ['Tracks', 'History', 'Settings'] as const;

// ── Branch dropdown ────────────────────────────────────────────────────────────

function BranchDropdown({
  playlist, activeBranch, onBranchChange, onBranchesChanged,
}: {
  playlist:          PlaylistRecord;
  activeBranch:      string;
  onBranchChange:    (name: string) => void;
  onBranchesChanged: () => void;
}) {
  const [open,          setOpen]          = useState(false);
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [renameVal,     setRenameVal]     = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [err,           setErr]           = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setRenamingId(null); setErr(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleDelete = async (branch: BranchRecord) => {
    setConfirmDelete(null);
    try {
      await invoke('branch_delete', { playlistId: playlist.id, name: branch.name });
      if (activeBranch === branch.name) {
        const fallback = playlist.branches.find(b => b.name !== branch.name);
        if (fallback) onBranchChange(fallback.name);
      }
      onBranchesChanged();
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleRename = async (branch: BranchRecord) => {
    if (!renameVal.trim() || renameVal.trim() === branch.name) {
      setRenamingId(null); return;
    }
    try {
      await invoke('branch_rename', { playlistId: playlist.id, oldName: branch.name, newName: renameVal.trim() });
      if (activeBranch === branch.name) onBranchChange(renameVal.trim());
      onBranchesChanged();
      setRenamingId(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(p => !p); setErr(null); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--bg-3)', border: '1px solid var(--border-1)',
          borderRadius: 4, padding: '2px 7px',
          fontSize: 10, color: 'var(--accent-light)',
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
        }}
      >
        <FiGitBranch size={10} />
        {activeBranch}
        <span style={{ color: 'var(--text-3)', marginLeft: 1 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          background: 'var(--bg-2)', border: '1px solid var(--border-2)',
          borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          zIndex: 200, minWidth: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: '5px 10px 3px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
            Branches
          </div>
          {playlist.branches.map(branch => (
            <div
              key={branch.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px',
                background: branch.name === activeBranch ? 'var(--bg-4)' : undefined,
              }}
            >
              {renamingId === branch.name ? (
                <>
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(branch);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    style={{
                      flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                      borderRadius: 3, padding: '2px 6px', fontSize: 11,
                      color: 'var(--text-0)', fontFamily: "'JetBrains Mono', monospace", outline: 'none',
                    }}
                  />
                  <button onClick={() => handleRename(branch)} style={iconBtn}><FiCheck size={11} /></button>
                  <button onClick={() => setRenamingId(null)}  style={iconBtn}><FiX    size={11} /></button>
                </>
              ) : confirmDelete === branch.name ? (
                /* ── Confirm delete ── */
                <>
                  <span style={{ flex: 1, fontSize: 11, color: '#f87171', fontFamily: "'Outfit', sans-serif" }}>
                    Delete "{branch.name}"?
                  </span>
                  <button
                    onClick={() => handleDelete(branch)}
                    style={{ ...iconBtn, color: '#f87171', fontSize: 10, padding: '2px 6px', border: '1px solid #f8717155', borderRadius: 3 }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    style={iconBtn}
                  >
                    <FiX size={11} />
                  </button>
                </>
              ) : (
                /* ── Normal row ── */
                <>
                  <button
                    onClick={() => { onBranchChange(branch.name); setOpen(false); }}
                    style={{
                      flex: 1, textAlign: 'left', background: 'none', border: 'none',
                      fontSize: 12, color: branch.name === activeBranch ? 'var(--text-0)' : 'var(--text-1)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: branch.name === activeBranch ? 700 : undefined,
                      cursor: 'pointer', padding: 0,
                    }}
                  >
                    {branch.name === activeBranch ? '● ' : '○ '}{branch.name}
                  </button>
                  {branch.head_commit && (
                    <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                      {branch.head_commit.slice(0, 7)}
                    </span>
                  )}
                  <button
                    onClick={() => { setRenamingId(branch.name); setRenameVal(branch.name); }}
                    title="Rename branch"
                    style={iconBtn}
                  >
                    <FiEdit2 size={10} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(branch.name)}
                    title="Delete branch"
                    disabled={playlist.branches.length <= 1}
                    style={{ ...iconBtn, color: 'var(--error, #f87171)', opacity: playlist.branches.length <= 1 ? 0.3 : 1 }}
                  >
                    <FiTrash2 size={10} />
                  </button>
                </>
              )}
            </div>
          ))}
          {err && (
            <div style={{ padding: '4px 10px 6px', fontSize: 10, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
              ✗ {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-3)', display: 'flex', padding: 2,
  borderRadius: 3,
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function PlaylistHeader({
  playlist, artworkUrl, activeBranch, onBranchChange, activeTab,
  onTabChange, isPinned, onTogglePin, onNewBranch, onMerge, onFork, onEditArtwork, onBranchesChanged,
}: PlaylistHeaderProps): JSX.Element {
  const name = playlist?.name ?? 'No playlist selected';
  const branch = playlist?.branches.find(b => b.name === activeBranch) ?? playlist?.branches[0];
  const commitShort = branch?.head_commit?.slice(0, 7) ?? null;

  return (
    <div className="border-b border-mm-b0 bg-mm-1 shrink-0">
      <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-2">
        {/* Artwork thumbnail — click to edit */}
        <button
          onClick={playlist ? onEditArtwork : undefined}
          title={playlist ? 'Edit playlist artwork' : undefined}
          className="w-11 h-11 rounded-lg shrink-0 shadow-md overflow-hidden relative group"
          style={{
            background: artworkUrl
              ? undefined
              : 'radial-gradient(ellipse at 40% 30%, var(--accent-dim) 0%, var(--bg-4) 100%)',
            border: 'none', padding: 0, cursor: playlist ? 'pointer' : 'default',
          }}
        >
          {artworkUrl && (
            <img src={artworkUrl} alt="playlist cover" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
          {playlist && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px]">✎</span>
            </div>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-mm-t0 truncate">{name}</span>
            {commitShort && (
              <span className="font-mono text-[10px] text-mm-t3 shrink-0">{commitShort}</span>
            )}
            {playlist && (
              <>
                <button
                  onClick={onTogglePin}
                  title={isPinned ? 'Unpin playlist' : 'Pin playlist'}
                  className={`btn btn-ghost btn-xs btn-square ${isPinned ? 'text-primary' : 'text-mm-t3'}`}
                >
                  <IcoPin filled={isPinned} />
                </button>
                <button
                  onClick={() => onTabChange('Settings')}
                  title="Playlist settings"
                  className={`btn btn-ghost btn-xs btn-square ${activeTab === 'Settings' ? 'text-primary' : 'text-mm-t3'}`}
                >
                  <GearIcon size={13} />
                </button>
              </>
            )}
          </div>
          {playlist?.description && (
            <div style={{
              fontSize: 11, color: 'var(--text-2)',
              marginTop: 1, lineHeight: 1.35,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {playlist.description}
            </div>
          )}

          <div className="flex items-center gap-2 mt-0.5">
            {playlist ? (
              <BranchDropdown
                playlist={playlist}
                activeBranch={activeBranch}
                onBranchChange={onBranchChange}
                onBranchesChanged={onBranchesChanged}
              />
            ) : (
              <p className="font-mono text-[10px] text-mm-t2">Select a playlist from the sidebar</p>
            )}
          </div>
        </div>

        {playlist && (
          <div className="flex gap-1.5 shrink-0">
            <button className="btn btn-ghost btn-xs gap-1" onClick={onFork} title="Fork this playlist into a new independent playlist">
              <TbGitFork size={12} />
              Fork
            </button>
            <button className="btn btn-ghost btn-xs" onClick={onNewBranch} title="New branch from current HEAD">⎇ Branch</button>
            {(playlist.branches?.length ?? 0) > 1 && (
              <button className="btn btn-ghost btn-xs gap-1" onClick={onMerge} title="Merge another branch into this one">
                <FiGitMerge size={12} />
                Merge
              </button>
            )}
            <button className="btn btn-primary btn-xs" disabled>↑ Push</button>
            <button className="btn btn-primary btn-xs" disabled>↓ Pull</button>
          </div>
        )}
      </div>

      <div className="tabs tabs-border px-2 -mb-px">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`tab text-[11px] ${activeTab === tab ? 'tab-active font-semibold' : 'text-mm-t2'}`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
