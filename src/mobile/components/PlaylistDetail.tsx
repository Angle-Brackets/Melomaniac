import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { PlaylistRecord, BranchRecord, PlaylistTrackRecord, CommitRecord } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef } from '../playerContext';
import { Icons } from '../icons';
import {
  MMArt, MMTabBar, MMHash, MMSheet, iconBtn,
} from './common';
import type { TabId } from './common';
import { MiniPlayer } from './Library';

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTotalDuration(tracks: PlaylistTrackRecord[]): string {
  const total = tracks.reduce((a, t) => a + t.duration_ms, 0);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTimestamp(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

const BRANCH_PALETTE = [
  'var(--accent)', 'var(--accent-light)', 'var(--blue)', 'var(--green)', 'var(--text-2)',
];
function branchColor(branches: BranchRecord[], name: string): string {
  const idx = branches.findIndex(b => b.name === name);
  return BRANCH_PALETTE[Math.max(0, idx) % BRANCH_PALETTE.length];
}

// ── Track row (real data)
function TrackRow({ track, idx, playing, onPlay }: {
  track: PlaylistTrackRecord; idx: number; playing?: boolean; onPlay?: () => void;
}) {
  const artUrl = useTrackArtwork(track.hash, track.artwork_hash);
  const accent = 'var(--accent)';
  return (
    <div onClick={onPlay} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
      background: playing ? `${accent}10` : 'transparent',
      borderLeft: playing ? `2px solid ${accent}` : '2px solid transparent',
      cursor: onPlay ? 'pointer' : 'default',
    }}>
      <span style={{ width: 20, textAlign: 'right', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
        {playing ? <Icons.play size={12}/> : String(idx + 1).padStart(2, '0')}
      </span>
      <MMArt src={artUrl ?? undefined} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</span>
          {track.favorited && <Icons.heartFill size={11} stroke="var(--accent)"/>}
          {(track.ab_start_ms != null) && (
            <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 4, background: 'oklch(0.32 0.10 50 / 0.4)' }}>A·B</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1 }}>{track.artist}</div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>{fmtMs(track.duration_ms)}</span>
      <Icons.moreV size={16} stroke="var(--text-3)"/>
    </div>
  );
}

// ── Branch picker sheet
function BranchPickerSheet({ playlist, activeBranchName, onSelect, onClose, onRefresh }: {
  playlist: PlaylistRecord;
  activeBranchName: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkName, setForkName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    setBusy(true);
    invoke('branch_create', { playlistId: playlist.id, name: newName.trim(), fromCommit: null })
      .then(() => { onRefresh(); onSelect(newName.trim()); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  const handleFork = () => {
    if (!forkName.trim()) return;
    setBusy(true);
    invoke('playlist_fork', { sourceId: playlist.id, newName: forkName.trim() })
      .then(() => { onRefresh(); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
      <MMSheet
        title="Branches"
        subtitle={`${playlist.name} · ${playlist.branches.length} branch${playlist.branches.length !== 1 ? 'es' : ''}`}
        height="80%"
        accessory={
          <button
            onClick={() => { setCreating(c => !c); setForking(false); }}
            style={{ padding: '7px 14px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Icons.plus size={13}/> New
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {creating && (
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--accent)', display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="branch-name"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-0)', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}
              />
              <button onClick={handleCreate} disabled={busy || !newName.trim()} style={{ padding: '4px 12px', borderRadius: 8, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (busy || !newName.trim()) ? 0.5 : 1 }}>
                Create
              </button>
            </div>
          )}

          {playlist.branches.map((b, i) => {
            const color = BRANCH_PALETTE[i % BRANCH_PALETTE.length];
            const isCurrent = b.name === activeBranchName;
            return (
              <div key={b.id} onClick={() => { onSelect(b.name); onClose(); }} style={{
                padding: '11px 13px', borderRadius: 12,
                background: isCurrent ? 'oklch(0.32 0.12 50 / 0.35)' : 'var(--bg-3)',
                border: `0.5px solid ${isCurrent ? color : 'var(--border-1)'}`,
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, fontSize: 14 }}>⎇</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace' }}>{b.name}</span>
                    {isCurrent && <span style={{ fontSize: 9.5, color: 'var(--bg-0)', background: color, padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>HEAD</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                    {b.head_commit ? b.head_commit.slice(0, 6) : 'empty'}
                  </div>
                </div>
                {isCurrent
                  ? <Icons.check size={18} stroke={color}/>
                  : <button style={iconBtn(28)} onClick={e => e.stopPropagation()}><Icons.moreV size={16} stroke="var(--text-2)"/></button>
                }
              </div>
            );
          })}

          {forking ? (
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--accent)', display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={forkName}
                onChange={e => setForkName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFork(); if (e.key === 'Escape') setForking(false); }}
                placeholder="New playlist name"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-0)', fontSize: 13 }}
              />
              <button onClick={handleFork} disabled={busy || !forkName.trim()} style={{ padding: '4px 12px', borderRadius: 8, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (busy || !forkName.trim()) ? 0.5 : 1 }}>
                Fork
              </button>
            </div>
          ) : (
            <div onClick={() => { setForking(true); setCreating(false); }} style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, border: '0.5px dashed var(--border-2)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', cursor: 'pointer' }}>
              <Icons.fork size={16}/>
              <div style={{ fontSize: 12.5, flex: 1 }}>Fork to a new playlist</div>
              <Icons.chevRight size={14}/>
            </div>
          )}
        </div>
      </MMSheet>
    </div>
  );
}

// ── Commit history
function HistoryView({ playlistId, branchName, playlistName, branches, onBack }: {
  playlistId: string; branchName: string; playlistName: string;
  branches: BranchRecord[]; onBack: () => void;
}) {
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    invoke<CommitRecord[]>('branch_get_history', { playlistId, branchName })
      .then(c => { setCommits(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, [playlistId, branchName]);

  const handleRevert = (commitHash: string) => {
    setReverting(commitHash);
    invoke('branch_revert_to', { playlistId, branchName, commitHash, message: '' })
      .then(() => {
        setReverting(null);
        // Reload history to show the new revert commit
        invoke<CommitRecord[]>('branch_get_history', { playlistId, branchName })
          .then(setCommits).catch(() => {});
      })
      .catch(e => { console.error(e); setReverting(null); });
  };

  const color = branchColor(branches, branchName);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '12px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>{playlistName}</span>
          </button>
        </div>

        <div style={{ padding: '4px 22px 12px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>History</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⎇</span><span>{branchName}</span>
            {!loading && <span>· {commits.length} commit{commits.length !== 1 ? 's' : ''}</span>}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 32px' }} className="mm-scroll">
          {loading && (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
          )}
          {!loading && commits.length === 0 && (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No commits yet.</div>
          )}
          {commits.map((c, i) => {
            const isLast = i === commits.length - 1;
            const isMerge = c.message?.startsWith('Merge') ?? false;
            return (
              <div key={c.hash} style={{ display: 'flex', padding: '8px 22px', gap: 14 }}>
                <div style={{ width: 22, position: 'relative', flexShrink: 0 }}>
                  {!isLast && (
                    <div style={{ position: 'absolute', left: 10, top: 22, bottom: -8, width: 1.5, background: color, opacity: 0.4 }}/>
                  )}
                  <div style={{
                    position: 'absolute', left: 4, top: 6, width: 14, height: 14,
                    borderRadius: isMerge ? 4 : 7,
                    background: color, border: '2px solid var(--bg-1)',
                    boxShadow: `0 0 0 1.5px ${color}, 0 0 10px ${color}55`,
                  }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 6, borderBottom: isLast ? 'none' : '0.5px solid var(--border-0)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <MMHash color={color}>{c.hash.slice(0, 6)}</MMHash>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {fmtTimestamp(c.timestamp)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-0)', marginTop: 4, lineHeight: 1.3 }}>
                    {c.message ?? 'No message'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{c.device_id}</span>
                    {i > 0 && (
                      <button
                        onClick={() => handleRevert(c.hash)}
                        disabled={reverting === c.hash}
                        style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, background: 'var(--bg-3)', border: '0.5px solid var(--border-2)', color: 'var(--text-1)', fontSize: 11, cursor: 'pointer', opacity: reverting === c.hash ? 0.5 : 1 }}
                      >
                        {reverting === c.hash ? '…' : 'Revert'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Merge sheet
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function DiffStat({ n, color, sub }: { n: string; color: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 18, color, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{n}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{sub}</span>
    </div>
  );
}

function MergeSheet({ playlist, targetBranch, targetTracks, onClose, onMerged }: {
  playlist: PlaylistRecord;
  targetBranch: string;
  targetTracks: PlaylistTrackRecord[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const otherBranches = playlist.branches.filter(b => b.name !== targetBranch);
  const [sourceBranch, setSourceBranch] = useState(otherBranches[0]?.name ?? '');
  const [strategy, setStrategy] = useState<'union' | 'intersection'>('union');
  const [sourceTracks, setSourceTracks] = useState<PlaylistTrackRecord[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sourceBranch) return;
    invoke<PlaylistTrackRecord[]>('playlist_get_tracks', { playlistId: playlist.id, branchName: sourceBranch })
      .then(setSourceTracks).catch(() => {});
  }, [sourceBranch, playlist.id]);

  const targetHashes = new Set(targetTracks.map(t => t.hash));
  const sourceHashes = new Set(sourceTracks.map(t => t.hash));
  const added   = sourceTracks.filter(t => !targetHashes.has(t.hash)).length;
  const removed = strategy === 'intersection' ? targetTracks.filter(t => !sourceHashes.has(t.hash)).length : 0;
  const total   = strategy === 'union'
    ? targetTracks.length + added
    : targetTracks.filter(t => sourceHashes.has(t.hash)).length;

  const handleMerge = () => {
    if (!sourceBranch) return;
    setBusy(true);
    invoke<string>('branch_merge', {
      playlistId: playlist.id,
      targetBranch,
      sourceBranch,
      strategy,
      message: null,
      descriptionOverride: null,
    }).then(() => { onMerged(); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}/>
      <MMSheet title={`Merge into ${targetBranch}`} subtitle={`${playlist.branches.length} branches available`} height="78%">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Field label="From branch">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {otherBranches.map((b) => {
                const color = BRANCH_PALETTE[(playlist.branches.findIndex(pb => pb.name === b.name)) % BRANCH_PALETTE.length];
                const sel = sourceBranch === b.name;
                return (
                  <button key={b.id} onClick={() => setSourceBranch(b.name)} style={{
                    padding: '8px 12px', borderRadius: 12,
                    background: sel ? `${color}1f` : 'var(--bg-3)',
                    border: `0.5px solid ${sel ? color : 'var(--border-1)'}`,
                    color: 'var(--text-0)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ color, fontSize: 12 }}>⎇</span>
                    <span style={{ fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace' }}>{b.name}</span>
                    {b.head_commit && <span style={{ fontSize: 10.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{b.head_commit.slice(0, 6)}</span>}
                  </button>
                );
              })}
              {otherBranches.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No other branches</span>
              )}
            </div>
          </Field>

          <Field label="Strategy">
            <div style={{ display: 'flex', gap: 6, padding: 3, background: 'var(--bg-3)', borderRadius: 12 }}>
              {(['union', 'intersection'] as const).map(s => (
                <button key={s} onClick={() => setStrategy(s)} style={{
                  flex: 1, padding: '8px 6px', borderRadius: 9,
                  background: strategy === s ? 'var(--bg-5)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }}>{s === 'union' ? 'Union' : 'Intersection'}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{s === 'union' ? 'all tracks from both' : 'only common tracks'}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Preview">
            <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <DiffStat n={`+${added}`} color="var(--green)" sub="added"/>
                <DiffStat n={`−${removed}`} color={removed > 0 ? '#f87171' : 'var(--text-2)'} sub="removed"/>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>→ {total} total</span>
              </div>
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 99, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', color: 'var(--text-1)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={busy || !sourceBranch || otherBranches.length === 0}
              style={{ flex: 2, padding: '12px', borderRadius: 99, background: 'var(--accent)', border: 'none', color: 'var(--bg-0)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (busy || !sourceBranch) ? 0.6 : 1 }}
            >
              {busy ? '…' : <><Icons.merge size={16}/> Merge</>}
            </button>
          </div>
        </div>
      </MMSheet>
    </div>
  );
}

function ActionTile({ Icon, label, badge, onPress }: {
  Icon: (p: { size?: number; stroke?: string }) => React.ReactElement;
  label: string; badge?: string; onPress?: () => void;
}) {
  return (
    <button onClick={onPress} style={{
      padding: '12px 6px', borderRadius: 12,
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      color: 'var(--text-0)', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      position: 'relative',
    }}>
      <Icon size={20} stroke="var(--text-0)"/>
      <span style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{label}</span>
      {badge && (
        <span style={{
          position: 'absolute', top: 8, right: 14,
          minWidth: 14, height: 14, borderRadius: 7, padding: '0 4px',
          background: 'var(--accent)', color: 'var(--bg-0)',
          fontSize: 9.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{badge}</span>
      )}
    </button>
  );
}

// ── Main PlaylistDetail component
export function PlaylistDetail({ onBack, onTab }: { onBack: () => void; onTab: (id: TabId) => void }) {
  const currentPlaylistId  = useStore(s => s.currentPlaylistId);
  const currentBranchName  = useStore(s => s.currentBranchName);
  const setCurrentBranch   = useStore(s => s.setCurrentBranch);
  const playlists          = useStore(s => s.playlists);
  const loadPlaylists      = useStore(s => s.loadPlaylists);
  const loadedTrackHash    = useStore(s => s.loadedTrackHash);
  const setLoaded          = useStore(s => s.setLoaded);
  const setPlaying         = useStore(s => s.setPlaying);
  const loadQueue          = useStore(s => s.loadQueue);

  const playlist = playlists.find(p => p.id === currentPlaylistId) ?? null;
  const artUrl   = usePlaylistArtwork(currentPlaylistId);

  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrackRecord[]>([]);
  const [tracksLoading, setTracksLoading]   = useState(true);
  const [sheet, setSheet] = useState<'branch' | 'merge' | null>(null);
  const [showHistory, setShowHistory]       = useState(false);

  const loadTracks = () => {
    if (!currentPlaylistId) return;
    setTracksLoading(true);
    invoke<PlaylistTrackRecord[]>('playlist_get_tracks', {
      playlistId: currentPlaylistId,
      branchName: currentBranchName,
    }).then(t => { setPlaylistTracks(t); setTracksLoading(false); })
      .catch(() => setTracksLoading(false));
  };

  useEffect(() => { loadTracks(); }, [currentPlaylistId, currentBranchName]);

  if (!playlist) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        No playlist selected
      </div>
    );
  }

  if (showHistory) {
    return (
      <div className="mobile-root">
        <HistoryView
          playlistId={playlist.id}
          branchName={currentBranchName}
          playlistName={playlist.name}
          branches={playlist.branches}
          onBack={() => setShowHistory(false)}
        />
      </div>
    );
  }

  const handlePlay = (startIdx = 0) => {
    if (playlistTracks.length === 0) return;
    const hashes = playlistTracks.map(t => t.hash);
    loadQueue(hashes);
    const track = playlistTracks[startIdx];
    setLoaded(track.hash, track.duration_ms);
    positionMsRef.current = 0;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    setPlaying(true);
  };

  const handleShuffle = () => {
    if (playlistTracks.length === 0) return;
    const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
    loadQueue(shuffled.map(t => t.hash));
    const track = shuffled[0];
    setLoaded(track.hash, track.duration_ms);
    positionMsRef.current = 0;
    invoke('track_play', { hash: track.hash }).catch(console.error);
    setPlaying(true);
  };

  const handleBranchSelect = (name: string) => {
    setCurrentBranch(name);
  };

  const handleRefresh = () => {
    loadPlaylists();
    loadTracks();
  };

  const activeBranch = playlist.branches.find(b => b.name === currentBranchName)
    ?? playlist.branches[0];
  const pendingBranches = playlist.branches.filter(b => b.head_commit !== activeBranch?.head_commit).length;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">

        {/* nav bar */}
        <div style={{ padding: '8px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>Playlists</span>
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={iconBtn(36)}><Icons.search size={18} stroke="var(--text-1)"/></button>
            <button style={iconBtn(36)}><Icons.more size={18} stroke="var(--text-1)"/></button>
          </div>
        </div>

        {/* header */}
        <div style={{ display: 'flex', gap: 16, padding: '8px 22px 8px', alignItems: 'flex-end' }}>
          <MMArt src={artUrl ?? undefined} size={112} radius={14} glow/>
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>{playlist.name}</h1>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
              {tracksLoading ? '…' : `${playlistTracks.length} tracks · ${fmtTotalDuration(playlistTracks)}`}
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setSheet('branch')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                <span>⎇</span>{currentBranchName}<Icons.chevDown size={11} stroke="var(--bg-0)"/>
              </button>
            </div>
          </div>
        </div>

        {/* description */}
        {playlist.description && (
          <div style={{ padding: '4px 22px 0', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}>
            {playlist.description}
          </div>
        )}

        {/* play / shuffle */}
        <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => handlePlay(0)} style={{ flex: 1, padding: '12px 14px', borderRadius: 99, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', color: 'var(--bg-0)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 14, boxShadow: '0 8px 22px oklch(0.62 0.15 28 / 0.4)' }}>
            <Icons.play size={16}/> Play
          </button>
          <button onClick={handleShuffle} style={iconBtn(44)}><Icons.shuffle size={20} stroke="var(--text-0)"/></button>
          <button style={iconBtn(44)}><Icons.download size={20} stroke="var(--text-1)"/></button>
        </div>

        {/* action tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '8px 16px 14px' }}>
          <ActionTile Icon={Icons.fork} label="Fork" onPress={() => setSheet('branch')}/>
          <ActionTile
            Icon={Icons.merge} label="Merge"
            badge={pendingBranches > 0 ? String(pendingBranches) : undefined}
            onPress={() => setSheet('merge')}
          />
          <ActionTile Icon={Icons.history} label="History" onPress={() => setShowHistory(true)}/>
          <ActionTile Icon={Icons.gear} label="Edit"/>
        </div>

        {/* tracks header */}
        <div style={{ padding: '4px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Tracks</h3>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
            {tracksLoading ? '…' : `${playlistTracks.length} · ${fmtTotalDuration(playlistTracks)}`}
          </span>
        </div>

        {tracksLoading && (
          <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        )}

        {!tracksLoading && playlistTracks.length === 0 && (
          <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No tracks on this branch yet.
          </div>
        )}

        {!tracksLoading && playlistTracks.map((track, i) => (
          <TrackRow
            key={track.hash}
            track={track}
            idx={i}
            playing={track.hash === loadedTrackHash}
            onPlay={() => handlePlay(i)}
          />
        ))}

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="playlists" onTab={onTab}/>

      {sheet === 'branch' && (
        <BranchPickerSheet
          playlist={playlist}
          activeBranchName={currentBranchName}
          onSelect={handleBranchSelect}
          onClose={() => setSheet(null)}
          onRefresh={handleRefresh}
        />
      )}
      {sheet === 'merge' && (
        <MergeSheet
          playlist={playlist}
          targetBranch={currentBranchName}
          targetTracks={playlistTracks}
          onClose={() => setSheet(null)}
          onMerged={() => { loadTracks(); loadPlaylists(); }}
        />
      )}
    </div>
  );
}
