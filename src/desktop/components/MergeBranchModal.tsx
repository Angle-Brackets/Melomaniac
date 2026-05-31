import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord, TrackRecord } from '../data';
import { IcoClose } from '../icons';
import { FiGitMerge } from 'react-icons/fi';

type Strategy = 'union' | 'intersection';
type DescChoice = 'target' | 'source';

interface BranchMeta { description: string | null; }

interface Props {
  playlist:           PlaylistRecord;
  targetBranch:       string;
  targetTrackHashes:  string[];
  targetDescription:  string | null;
  onClose:            () => void;
  onMerged:           (commitHash: string) => void;
  closing?:           boolean;
}

export default function MergeBranchModal({
  playlist, targetBranch, targetTrackHashes, targetDescription, onClose, onMerged, closing,
}: Props) {
  const otherBranches = playlist.branches.filter(b => b.name !== targetBranch);

  const [sourceBranch,  setSourceBranch]  = useState(otherBranches[0]?.name ?? '');
  const [strategy,      setStrategy]      = useState<Strategy>('union');
  const [message,       setMessage]       = useState(`Merge '${otherBranches[0]?.name ?? ''}' into '${targetBranch}'`);
  const [sourceHashes,  setSourceHashes]  = useState<string[]>([]);
  const [sourceMeta,    setSourceMeta]    = useState<BranchMeta | null>(null);
  const [loadingPrev,   setLoadingPrev]   = useState(false);
  const [descChoice,    setDescChoice]    = useState<DescChoice>('target');
  const [submitting,    setSubmitting]    = useState(false);
  const [err,           setErr]           = useState<string | null>(null);

  // Load source branch tracks + meta for preview and conflict detection
  useEffect(() => {
    if (!sourceBranch) return;
    setLoadingPrev(true);
    Promise.all([
      invoke<TrackRecord[]>('playlist_get_tracks', { playlistId: playlist.id, branchName: sourceBranch }),
      invoke<BranchMeta>('playlist_get_meta', { playlistId: playlist.id, branchName: sourceBranch }),
    ])
      .then(([tracks, meta]) => { setSourceHashes(tracks.map(t => t.hash)); setSourceMeta(meta); })
      .catch(() => { setSourceHashes([]); setSourceMeta(null); })
      .finally(() => setLoadingPrev(false));
    setDescChoice('target'); // reset choice when source changes
  }, [sourceBranch, playlist.id]);

  // Update default message when source changes
  useEffect(() => {
    setMessage(`Merge '${sourceBranch}' into '${targetBranch}'`);
  }, [sourceBranch, targetBranch]);

  const targetSet = new Set(targetTrackHashes);
  const sourceSet = new Set(sourceHashes);
  const toAdd     = sourceHashes.filter(h => !targetSet.has(h));
  const toRemove  = targetTrackHashes.filter(h => !sourceSet.has(h));
  const kept      = targetTrackHashes.filter(h => sourceSet.has(h));

  const preview = loadingPrev ? null : strategy === 'union'
    ? { adds: toAdd.length, removes: 0,           result: targetTrackHashes.length + toAdd.length }
    : { adds: 0,            removes: toRemove.length, result: kept.length };

  const descConflict = sourceMeta !== null &&
    (sourceMeta.description ?? null) !== (targetDescription ?? null);

  const handleMerge = async () => {
    if (!sourceBranch) return;
    setSubmitting(true);
    setErr(null);
    try {
      const descriptionOverride = descConflict && descChoice === 'source'
        ? (sourceMeta?.description ?? null)
        : null; // null → keep target's description (Rust default)
      const hash = await invoke<string>('branch_merge', {
        playlistId:   playlist.id,
        targetBranch,
        sourceBranch,
        strategy,
        message: message.trim() || null,
        descriptionOverride,
      });
      onMerged(hash);
    } catch (e) {
      setErr(String(e));
      setSubmitting(false);
    }
  };

  const bdClass  = closing ? 'mm-backdrop-exit'  : 'mm-backdrop';
  const boxClass = closing ? 'mm-modal-box-exit' : 'mm-modal-box';

  if (otherBranches.length === 0) {
    return (
      <div style={BACKDROP} className={bdClass} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={BOX} className={boxClass}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={TITLE_STYLE}><FiGitMerge size={16} style={{ color: 'var(--accent-light)', marginRight: 8 }} />Merge branch</span>
            <button onClick={onClose} style={CLOSE_BTN}><IcoClose size={14} /></button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif" }}>
            No other branches to merge from. Create a branch first.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={BTN_GHOST}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={BACKDROP} className={bdClass} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={BOX} className={boxClass}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <FiGitMerge size={18} style={{ color: 'var(--accent-light)' }} />
            <span style={TITLE_STYLE}>
              Merge into <span style={{ color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>{targetBranch}</span>
            </span>
          </div>
          <button onClick={onClose} style={CLOSE_BTN}><IcoClose size={14} /></button>
        </div>

        {/* Source branch */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={LABEL}>Source branch</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {otherBranches.map(b => (
              <button
                key={b.name}
                onClick={() => setSourceBranch(b.name)}
                style={{
                  padding: '5px 12px', borderRadius: 5, fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
                  background: sourceBranch === b.name ? 'var(--accent-dim)' : 'var(--bg-2)',
                  border: `1px solid ${sourceBranch === b.name ? 'var(--accent)' : 'var(--border-1)'}`,
                  color: sourceBranch === b.name ? 'var(--accent-light)' : 'var(--text-1)',
                }}
              >
                ⎇ {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Strategy */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={LABEL}>Strategy</label>
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-1)', borderRadius: 6, overflow: 'hidden' }}>
            {(['union', 'intersection'] as Strategy[]).map(s => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                style={{
                  flex: 1, padding: '7px 0', fontSize: 12, cursor: 'pointer', border: 'none',
                  fontFamily: "'Outfit', sans-serif", fontWeight: strategy === s ? 600 : 400,
                  background: strategy === s ? 'var(--accent-dim)' : 'var(--bg-2)',
                  color: strategy === s ? 'var(--accent-light)' : 'var(--text-2)',
                  borderRight: s === 'union' ? '1px solid var(--border-1)' : 'none',
                }}
              >
                {s === 'union' ? '⊔ Union' : '⊓ Intersection'}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif", margin: 0 }}>
            {strategy === 'union'
              ? 'Keeps all tracks from both branches. Tracks unique to the source are appended.'
              : 'Keeps only tracks that appear in both branches. Removes any track not shared.'}
          </p>
        </div>

        {/* Description conflict */}
        {descConflict && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ ...LABEL, color: '#f59e0b' }}>⚠ Description conflict</label>
            {(['target', 'source'] as DescChoice[]).map(side => {
              const desc = side === 'target' ? targetDescription : sourceMeta?.description;
              const branch = side === 'target' ? targetBranch : sourceBranch;
              const chosen = descChoice === side;
              return (
                <button
                  key={side}
                  onClick={() => setDescChoice(side)}
                  style={{
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    textAlign: 'left', border: `1px solid ${chosen ? 'var(--accent)' : 'var(--border-1)'}`,
                    background: chosen ? 'var(--accent-dim)' : 'var(--bg-2)',
                  }}
                >
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                    color: chosen ? 'var(--accent-light)' : 'var(--text-2)', marginBottom: 2 }}>
                    {side === 'target' ? '← keep' : '← use'} ⎇ {branch}
                  </div>
                  <div style={{ fontSize: 12, color: chosen ? 'var(--accent-light)' : 'var(--text-1)',
                    fontFamily: "'Outfit', sans-serif" }}>
                    {desc ? `"${desc}"` : <em style={{ color: 'var(--text-3)' }}>no description</em>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border-1)',
            borderRadius: 7, padding: '10px 14px', display: 'flex', gap: 20,
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          }}>
            {strategy === 'union' ? (
              <>
                <span style={{ color: preview.adds > 0 ? '#4ade80' : 'var(--text-3)' }}>+{preview.adds} added</span>
                <span style={{ color: 'var(--text-3)' }}>→ {preview.result} total</span>
              </>
            ) : (
              <>
                <span style={{ color: preview.removes > 0 ? '#f87171' : 'var(--text-3)' }}>−{preview.removes} removed</span>
                <span style={{ color: 'var(--text-3)' }}>→ {preview.result} total</span>
              </>
            )}
          </div>
        )}

        {/* Message */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={LABEL}>Commit message</label>
          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleMerge(); if (e.key === 'Escape') onClose(); }}
            style={{
              background: 'var(--bg-2)', border: '1px solid var(--border-1)',
              borderRadius: 6, color: 'var(--text-0)', fontSize: 13,
              padding: '8px 12px', outline: 'none', fontFamily: "'Outfit', sans-serif",
            }}
          />
        </div>

        {err && <span style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{err}</span>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button onClick={onClose} style={BTN_GHOST}>Cancel</button>
          <button
            onClick={handleMerge}
            disabled={!sourceBranch || submitting}
            style={{ ...BTN_PRIMARY, opacity: (!sourceBranch || submitting) ? 0.5 : 1, cursor: (!sourceBranch || submitting) ? 'not-allowed' : 'pointer' }}
          >
            <FiGitMerge size={13} />
            {submitting ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}

const BACKDROP: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 300,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const BOX: React.CSSProperties = {
  width: 500, background: 'var(--bg-3)',
  border: '1px solid var(--border-2)', borderRadius: 12,
  padding: 28, display: 'flex', flexDirection: 'column', gap: 20,
  boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: 'var(--text-0)',
  fontFamily: "'Outfit', sans-serif",
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-3)', padding: 2,
};

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  fontFamily: "'Outfit', sans-serif",
};

const BTN_GHOST: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
  color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif",
  display: 'flex', alignItems: 'center', gap: 7,
};
