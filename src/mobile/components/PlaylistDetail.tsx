import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import type { PlaylistRecord, PlaylistTrackRecord } from '../../store/types';
import { ShuffleMode } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { usePlaylistArtwork } from '../hooks/usePlaylistArtwork';
import { positionMsRef } from '../playerContext';
import { Icons } from '../icons';
import {
  MMArt, MMTabBar, MMHash, MMSheet, MMLoader, iconBtn, useMinDuration,
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

function useHorizDragScroll() {
  const ref      = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; sl: number } | null>(null);
  const didDrag  = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    startRef.current = { x: e.clientX, sl: ref.current.scrollLeft };
    didDrag.current  = false;
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current || !ref.current) return;
    const dx = startRef.current.x - e.clientX;
    if (Math.abs(dx) > 4) didDrag.current = true;
    ref.current.scrollLeft = startRef.current.sl + dx;
  }, []);
  const onPointerUp = useCallback(() => { startRef.current = null; }, []);
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDrag.current) { e.stopPropagation(); didDrag.current = false; }
  }, []);
  return { ref, onPointerDown, onPointerMove, onPointerUp, onClickCapture };
}

const BRANCH_PALETTE = [
  'var(--accent)', 'var(--accent-light)', 'var(--blue)', 'var(--green)', 'var(--text-2)',
];

// ── Commit graph types & layout ──────────────────────────────────────────────
interface GraphNode {
  hash: string; tree_hash: string; timestamp: number;
  device_id: string; message: string | null;
  parents: string[]; refs: string[];
}

const GRAPH_PALETTE = ['var(--accent)', 'var(--accent-light)', '#4dabf7', '#69db7c', '#ffa94d', '#da77f2', '#f783ac', '#a9e34b'];
const GN_H   = 50;
const GLANE_W = 16;
const GDOT_R  = 4.5;
const GLINE_W = 1.5;

function gLx(lane: number) { return lane * GLANE_W + GLANE_W / 2; }
function gLaneCol(i: number) { return GRAPH_PALETTE[i % GRAPH_PALETTE.length]; }
function gPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1},${y1} L${x1},${y2}`;
  const cy = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
}

interface GRowLine { x1: number; y1: number; x2: number; y2: number; col: string; }
interface GRowLayout {
  commit: GraphNode; lane: number; color: string;
  svgW: number; lines: GRowLine[]; dotCx: number; dotCy: number;
}


function computeGLayout(commits: GraphNode[]): GRowLayout[] {
  const lanes: Array<string | null> = [];
  const colors: string[] = [];
  const HALF = GN_H / 2;

  const mainTip = commits.find(c => c.refs.includes('main'));
  const mainTipHash = mainTip?.hash ?? null;
  const mainIsDirect = mainTipHash !== null && commits.some(c => c.parents[0] === mainTipHash);
  let mainPlaced = mainTipHash === null || mainIsDirect;

  const alloc = (hash: string): number => {
    if (hash === mainTipHash && !mainPlaced) {
      mainPlaced = true;
      while (lanes.length === 0) lanes.push(null);
      lanes[0] = hash; colors[0] = gLaneCol(0); return 0;
    }
    const start = !mainPlaced ? 1 : 0;
    for (let i = start; ; i++) {
      while (i >= lanes.length) lanes.push(null);
      if (lanes[i] === null) { lanes[i] = hash; colors[i] = gLaneCol(i); return i; }
    }
  };

  return commits.map(commit => {
    let myLane = lanes.indexOf(commit.hash);
    const isNew = myLane === -1;
    if (isNew) myLane = alloc(commit.hash);
    const myColor = colors[myLane];
    const before = [...lanes]; before[myLane] = commit.hash;
    lanes[myLane] = null;

    const parentLanes: { lane: number }[] = [];
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const p = commit.parents[pi]; const ex = lanes.indexOf(p);
      if (ex !== -1)    { parentLanes.push({ lane: ex }); }
      else if (pi === 0) { lanes[myLane] = p; parentLanes.push({ lane: myLane }); }
      else               { parentLanes.push({ lane: alloc(p) }); }
    }

    const after = [...lanes];
    const lines: GRowLine[] = [];
    const maxIdx = Math.max(before.length, after.length, myLane + 1);
    for (let i = 0; i < maxIdx; i++) {
      if (i === myLane) continue;
      const hB = before[i] ?? null; const hA = after[i] ?? null;
      const c  = colors[i] ?? gLaneCol(i);
      if (hB && hA && hB === hA) lines.push({ x1: gLx(i), y1: 0, x2: gLx(i), y2: GN_H, col: c });
      else if (hB && !hA)        lines.push({ x1: gLx(i), y1: 0, x2: gLx(i), y2: HALF,  col: c });
    }
    if (!isNew) lines.push({ x1: gLx(myLane), y1: 0, x2: gLx(myLane), y2: HALF, col: myColor });
    for (let pi = 0; pi < parentLanes.length; pi++) {
      const p = parentLanes[pi];
      const lineCol = pi === 0 ? myColor : (colors[p.lane] ?? myColor);
      lines.push({ x1: gLx(myLane), y1: HALF, x2: gLx(p.lane), y2: GN_H, col: lineCol });
    }

    const maxLane = Math.max(
      myLane,
      before.reduce((m, v, i) => v ? Math.max(m, i) : m, 0),
      after.reduce( (m, v, i) => v ? Math.max(m, i) : m, 0),
      ...parentLanes.map(p => p.lane),
    );
    return { commit, lane: myLane, color: myColor, svgW: (maxLane + 1) * GLANE_W + GLANE_W / 2, lines, dotCx: gLx(myLane), dotCy: HALF };
  });
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
        {playing ? <Icons.play size={12}/> : String(idx + 1).padStart(2, '00')}
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
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const activeBranchHead = playlist.branches.find(b => b.name === activeBranchName)?.head_commit ?? null;

  const handleCreate = () => {
    if (!newName.trim()) return;
    setBusy(true);
    // Branch from the active branch's HEAD so the new branch starts with its current state
    invoke('branch_create', { playlistId: playlist.id, name: newName.trim(), fromCommit: activeBranchHead })
      .then(() => { onRefresh(); onSelect(newName.trim()); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  const handleDelete = (branchName: string) => {
    setBusy(true);
    invoke('branch_delete', { playlistId: playlist.id, name: branchName })
      .then(() => { setConfirmDelete(null); onRefresh(); })
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
            onClick={() => setCreating(c => !c)}
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
                {isCurrent ? (
                  <Icons.check size={18} stroke={color}/>
                ) : confirmDelete === b.name ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: '#f87171' }}>Delete?</span>
                    <button
                      onClick={() => handleDelete(b.name)}
                      disabled={busy}
                      style={{ padding: '3px 10px', borderRadius: 8, background: '#f87171', color: '#fff', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
                    >Yes</button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      style={{ padding: '3px 10px', borderRadius: 8, background: 'var(--bg-4)', color: 'var(--text-1)', border: 'none', fontSize: 11, cursor: 'pointer' }}
                    >No</button>
                  </div>
                ) : (
                  <button
                    style={iconBtn(28)}
                    onClick={e => { e.stopPropagation(); setConfirmDelete(b.name); }}
                  >
                    <Icons.trash size={15} stroke="#f87171"/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </MMSheet>
    </div>
  );
}

// ── Fork sheet
function ForkSheet({ playlist, onClose, onForked }: {
  playlist: PlaylistRecord;
  onClose: () => void;
  onForked: (name: string) => void;
}) {
  const [forkName, setForkName] = useState(`${playlist.name} (fork)`);
  const [busy, setBusy] = useState(false);

  const handleFork = () => {
    if (!forkName.trim()) return;
    setBusy(true);
    invoke('playlist_fork', { sourceId: playlist.id, newName: forkName.trim() })
      .then(() => { onForked(forkName.trim()); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
      <MMSheet title="Fork Playlist" subtitle={`Fork "${playlist.name}" to a new playlist`} height="52%">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>New playlist name</span>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={forkName}
                onChange={e => setForkName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFork(); if (e.key === 'Escape') onClose(); }}
                placeholder="Playlist name"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-0)', fontSize: 13 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 99, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', color: 'var(--text-1)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleFork}
              disabled={busy || !forkName.trim()}
              style={{ flex: 2, padding: '12px', borderRadius: 99, background: 'var(--accent)', border: 'none', color: 'var(--bg-0)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (busy || !forkName.trim()) ? 0.6 : 1 }}
            >
              {busy ? '…' : <><Icons.fork size={16}/> Fork</>}
            </button>
          </div>
        </div>
      </MMSheet>
    </div>
  );
}

// ── Edit sheet
function EditSheet({ playlist, currentBranchName, onClose, onSaved, onDeleted }: {
  playlist: PlaylistRecord;
  currentBranchName: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(playlist.name);
  const [desc, setDesc] = useState(playlist.description ?? '');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      const ops: Promise<unknown>[] = [];
      if (name.trim() !== playlist.name) {
        ops.push(invoke('playlist_rename', { playlistId: playlist.id, branchName: currentBranchName, newName: name.trim(), message: '' }));
      }
      if ((desc || null) !== playlist.description) {
        ops.push(invoke('playlist_set_description', { playlistId: playlist.id, branchName: currentBranchName, description: desc.trim() || null }));
      }
      await Promise.all(ops);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${playlist.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await invoke('playlist_delete', { playlistId: playlist.id });
      onDeleted();
    } catch (e) {
      console.error(e);
      setDeleting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
    background: 'var(--bg-3)', border: '0.5px solid var(--border-1)',
    outline: 'none', color: 'var(--text-0)', fontSize: 14,
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
      <MMSheet title="Edit Playlist" subtitle={playlist.name} height="62%">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Name</span>
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Playlist name"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Description</span>
            </div>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 99, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', color: 'var(--text-1)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !name.trim()}
              style={{ flex: 2, padding: '12px', borderRadius: 99, background: 'var(--accent)', border: 'none', color: 'var(--bg-0)', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (busy || !name.trim()) ? 0.6 : 1 }}
            >
              {busy ? '…' : 'Save'}
            </button>
          </div>

          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ width: '100%', padding: '12px', borderRadius: 99, background: 'transparent', border: '0.5px solid #f87171', color: '#f87171', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}
          >
            {deleting ? '…' : 'Delete Playlist'}
          </button>
        </div>
      </MMSheet>
    </div>
  );
}

function BranchPill({ label, active, color, onClick }: {
  label: string; active: boolean; color?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 99, flexShrink: 0, whiteSpace: 'nowrap',
      background: active ? (color ?? 'var(--accent)') : 'var(--bg-2)',
      border: active ? `1px solid ${color ?? 'var(--accent)'}` : '0.5px solid var(--border-1)',
      color: active ? 'var(--bg-0)' : 'var(--text-1)',
      fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {color && <span style={{ fontSize: 10, opacity: active ? 0.8 : 0.5 }}>⎇</span>}
      {label}
    </button>
  );
}

// ── Commit graph history view
function CommitGraphView({ playlistId, branchName, playlistName, branchNames, onBack, onRefresh }: {
  playlistId: string; branchName: string; playlistName: string;
  branchNames: string[];
  onBack: () => void; onRefresh: () => void;
}) {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [layout,   setLayout]   = useState<GRowLayout[]>([]);
  const [loadingRaw, setLoading]  = useState(true);
  const loading = useMinDuration(loadingRaw);
  const [selected, setSelected] = useState<GRowLayout | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy]           = useState(false);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const pillScroll = useHorizDragScroll();

  useEffect(() => {
    setLoading(true);
    invoke<GraphNode[]>('playlist_get_graph', { playlistId })
      .then(nodes => { setAllNodes(nodes); setLoading(false); })
      .catch(() => setLoading(false));
  }, [playlistId]);

  useEffect(() => {
    if (!allNodes.length) { setLayout([]); return; }
    // Show all branches in the graph, ordered newest-first
    const sorted = [...allNodes].sort((a, b) => b.timestamp - a.timestamp);
    setLayout(computeGLayout(sorted));
  }, [allNodes]);

  // When a branch pill is selected, walk from its HEAD commit backwards to collect
  // all ancestor hashes — used to filter the layout to only that branch's history.
  const ancestorSet = useMemo(() => {
    if (!filterBranch) return null;
    const byHash = new Map(allNodes.map(n => [n.hash, n]));
    const head = allNodes.find(n => n.refs.includes(filterBranch));
    if (!head) return null;
    const visited = new Set<string>();
    const queue = [head.hash];
    while (queue.length) {
      const h = queue.shift()!;
      if (visited.has(h)) continue;
      visited.add(h);
      byHash.get(h)?.parents.forEach(p => queue.push(p));
    }
    return visited;
  }, [filterBranch, allNodes]);

  // Re-run layout on only the filtered commits so lane assignments and connecting
  // lines are clean — filtering the full layout leaves orphaned cross-lane lines.
  const filteredLayout = useMemo(() => {
    if (!ancestorSet) return layout;
    const nodes = allNodes.filter(n => ancestorSet.has(n.hash));
    const sorted = [...nodes].sort((a, b) => b.timestamp - a.timestamp);
    return computeGLayout(sorted);
  }, [ancestorSet, allNodes, layout]);

  const svgMaxW = filteredLayout.length ? Math.max(GLANE_W * 2, ...filteredLayout.map(r => r.svgW)) : GLANE_W * 2;

  const handleBranchFrom = (commitHash: string) => {
    if (!newBranch.trim() || busy) return;
    setBusy(true);
    invoke('branch_create', { playlistId, name: newBranch.trim(), fromCommit: commitHash })
      .then(() => { onRefresh(); setNewBranch(''); setSelected(null); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  const handleRevert = (commitHash: string) => {
    setBusy(true);
    invoke('branch_revert_to', { playlistId, branchName, commitHash, message: `Revert to ${commitHash.slice(0, 6)}` })
      .then(() => { onRefresh(); setSelected(null); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px 0', display: 'flex', alignItems: 'center' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>{playlistName}</span>
          </button>
        </div>
        <div style={{ padding: '4px 22px 6px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>History</h1>
          {!loading && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
              {filteredLayout.length} commit{filteredLayout.length !== 1 ? 's' : ''}
              {!filterBranch && branchNames.length > 1 && ` across ${branchNames.length} branch${branchNames.length !== 1 ? 'es' : ''}`}
            </div>
          )}
        </div>

        {/* Branch filter pills */}
        <div
          ref={pillScroll.ref}
          onPointerDown={pillScroll.onPointerDown}
          onPointerMove={pillScroll.onPointerMove}
          onPointerUp={pillScroll.onPointerUp}
          onClickCapture={pillScroll.onClickCapture}
          style={{
            display: 'flex', gap: 8, overflowX: 'auto', touchAction: 'pan-x',
            paddingTop: 4, paddingBottom: 10, paddingLeft: 22, paddingRight: 0,
            cursor: 'grab',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 80%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 0%, black 80%, transparent 100%)',
          }}
          className="mm-scroll"
        >
          <BranchPill label="All branches" active={filterBranch === null} onClick={() => setFilterBranch(null)}/>
          {branchNames.map((name, i) => (
            <BranchPill
              key={name}
              label={name}
              active={filterBranch === name}
              color={GRAPH_PALETTE[i % GRAPH_PALETTE.length]}
              onClick={() => setFilterBranch(f => f === name ? null : name)}
            />
          ))}
          <div style={{ width: 22, flexShrink: 0 }}/>
        </div>

        <div style={{ flex: 1, overflowY: loading ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }} className="mm-scroll">
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MMLoader size={48}/>
            </div>
          )}
          {!loading && filteredLayout.length === 0 && <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>{filterBranch ? 'No commits on this branch.' : 'No commits yet.'}</div>}

          {!loading && filteredLayout.map((row) => {
            const isSel = selected?.commit.hash === row.commit.hash;
            return (
              <div key={row.commit.hash} onClick={() => setSelected(isSel ? null : row)}
                style={{ height: GN_H, display: 'flex', alignItems: 'stretch', borderBottom: '0.5px solid var(--border-0)', cursor: 'pointer', background: isSel ? 'oklch(0.28 0.06 30 / 0.6)' : undefined, transition: 'background 0.1s' }}>
                {/* SVG lane */}
                <div style={{ width: svgMaxW, flexShrink: 0 }}>
                  <svg width={svgMaxW} height={GN_H} style={{ overflow: 'visible' }}>
                    {row.lines.map((l, j) => (
                      <path key={j} d={gPath(l.x1, l.y1, l.x2, l.y2)} stroke={l.col} strokeWidth={GLINE_W} fill="none" strokeLinecap="round"/>
                    ))}
                    {row.commit.parents.length > 1 ? (
                      <rect
                        x={row.dotCx - GDOT_R * 0.9} y={row.dotCy - GDOT_R * 0.9}
                        width={GDOT_R * 1.8} height={GDOT_R * 1.8}
                        transform={`rotate(45,${row.dotCx},${row.dotCy})`}
                        fill={row.color} stroke={isSel ? '#fff' : 'var(--bg-1)'} strokeWidth={isSel ? 2 : 1.5}
                        style={{ filter: isSel ? `drop-shadow(0 0 5px ${row.color})` : undefined }}
                      />
                    ) : (
                      <circle cx={row.dotCx} cy={row.dotCy} r={isSel ? GDOT_R + 1.5 : GDOT_R}
                        fill={row.color} stroke={isSel ? '#fff' : 'var(--bg-1)'} strokeWidth={isSel ? 2 : 1.5}
                        style={{ filter: isSel ? `drop-shadow(0 0 5px ${row.color})` : undefined }}
                      />
                    )}
                  </svg>
                </div>
                {/* Commit info */}
                <div style={{ flex: 1, minWidth: 0, padding: '0 12px 0 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    {/* badges — allowed to shrink/clip so timestamp is never pushed off */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <MMHash color={row.color}>{row.commit.hash.slice(0, 6)}</MMHash>
                      {row.commit.parents.length > 1 && (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-4)', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>⋈ merge</span>
                      )}
                      {row.commit.refs.map(r => (
                        <span key={r} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'oklch(0.32 0.10 50 / 0.35)', color: 'var(--accent-light)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>⎇ {r}</span>
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>{fmtTimestamp(row.commit.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: isSel ? 'var(--text-0)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSel ? 600 : undefined }}>
                    {row.commit.message ?? <em style={{ color: 'var(--text-3)' }}>no message</em>}
                  </div>
                </div>
              </div>
            );
          })}
          {!loading && <div style={{ height: 32 }}/>}
        </div>
      </div>

      {/* Commit detail sheet */}
      {selected && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => { setSelected(null); setBusy(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}/>
          <MMSheet
            title={selected.commit.hash.slice(0, 7)}
            subtitle={new Date(selected.commit.timestamp * 1000).toLocaleString()}
            height="58%"
            onClose={() => setSelected(null)}
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selected.commit.message && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.08, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>Message</div>
                  <div style={{ fontSize: 14, color: 'var(--text-0)', lineHeight: 1.4 }}>{selected.commit.message}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.08, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>Author</div>
                  <div style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'JetBrains Mono, monospace' }}>{selected.commit.device_id}</div>
                </div>
                {selected.commit.refs.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.08, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>Refs</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {selected.commit.refs.map(r => (
                        <span key={r} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: `${selected.color}22`, color: selected.color, fontFamily: 'JetBrains Mono, monospace', border: `1px solid ${selected.color}44` }}>⎇ {r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: 'var(--border-1)' }}/>

              <div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.08, fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }}>Branch from here</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newBranch}
                    onChange={e => setNewBranch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleBranchFrom(selected.commit.hash); }}
                    placeholder="branch-name"
                    style={{ flex: 1, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', color: 'var(--text-0)', fontFamily: 'JetBrains Mono, monospace' }}
                  />
                  <button onClick={() => handleBranchFrom(selected.commit.hash)} disabled={busy || !newBranch.trim()}
                    style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (busy || !newBranch.trim()) ? 0.5 : 1 }}>⎇</button>
                </div>
              </div>

              <button onClick={() => handleRevert(selected.commit.hash)} disabled={busy}
                style={{ padding: '11px', borderRadius: 10, border: '0.5px solid var(--border-2)', background: 'var(--bg-3)', fontSize: 13, color: 'var(--text-1)', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
                {busy ? '…' : `↩ Revert ${branchName} to here`}
              </button>
            </div>
          </MMSheet>
        </div>
      )}
    </div>
  );
}

// ── Merge sheet
function MField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{hint}</span>}
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

  // Descriptions
  const [targetDesc, setTargetDesc] = useState<string | null>(null);
  const [sourceDesc, setSourceDesc] = useState<string | null>(null);
  const [descChoice, setDescChoice] = useState<'target' | 'source' | 'custom'>('target');
  const [customDesc, setCustomDesc] = useState('');

  // Commit message
  const [commitMsg, setCommitMsg] = useState('');

  useEffect(() => {
    invoke<{ description: string | null }>('playlist_get_meta', { playlistId: playlist.id, branchName: targetBranch })
      .then(m => setTargetDesc(m.description)).catch(() => {});
  }, [playlist.id, targetBranch]);

  useEffect(() => {
    if (!sourceBranch) return;
    invoke<PlaylistTrackRecord[]>('playlist_get_tracks', { playlistId: playlist.id, branchName: sourceBranch })
      .then(setSourceTracks).catch(() => {});
    invoke<{ description: string | null }>('playlist_get_meta', { playlistId: playlist.id, branchName: sourceBranch })
      .then(m => { setSourceDesc(m.description); setDescChoice('target'); }).catch(() => {});
  }, [sourceBranch, playlist.id]);

  const targetHashes  = new Set(targetTracks.map(t => t.hash));
  const sourceHashes  = new Set(sourceTracks.map(t => t.hash));
  const targetIdxMap  = new Map(targetTracks.map((t, i) => [t.hash, i]));
  const sourceIdxMap  = new Map(sourceTracks.map((t, i) => [t.hash, i]));

  const addedTracks    = sourceTracks.filter(t => !targetHashes.has(t.hash));
  const removedTracks  = strategy === 'intersection' ? targetTracks.filter(t => !sourceHashes.has(t.hash)) : [];
  const reorderedTracks = sourceTracks.filter(t =>
    targetHashes.has(t.hash) && (targetIdxMap.get(t.hash) ?? 0) !== (sourceIdxMap.get(t.hash) ?? 0)
  );

  const added    = addedTracks.length;
  const removed  = removedTracks.length;
  const reordered = reorderedTracks.length;
  const total    = strategy === 'union'
    ? targetTracks.length + added
    : targetTracks.filter(t => sourceHashes.has(t.hash)).length;

  // Build preview rows: added (green), removed (red), reordered (blue) — cap at 8
  type DiffRow = { kind: 'added' | 'removed' | 'reordered'; title: string; detail?: string };
  const previewRows: DiffRow[] = [
    ...addedTracks.slice(0, 5).map(t => ({ kind: 'added' as const, title: t.title })),
    ...removedTracks.slice(0, 3).map(t => ({ kind: 'removed' as const, title: t.title })),
    ...reorderedTracks.slice(0, 3).map(t => ({
      kind: 'reordered' as const,
      title: t.title,
      detail: `moved to #${(targetIdxMap.get(t.hash) ?? 0) + 1}`,
    })),
  ].slice(0, 8);
  const hiddenCount = (added + removed + reordered) - previewRows.length;

  const descConflict = sourceDesc !== null && targetDesc !== sourceDesc;

  const handleMerge = () => {
    if (!sourceBranch) return;
    setBusy(true);
    let descOverride: string | null = null;
    if (descConflict) {
      if (descChoice === 'source')      descOverride = sourceDesc;
      else if (descChoice === 'custom') descOverride = customDesc.trim() || null;
      else                              descOverride = targetDesc;
    }
    invoke<string>('branch_merge', {
      playlistId: playlist.id,
      targetBranch,
      sourceBranch,
      strategy,
      message: commitMsg.trim() || null,
      descriptionOverride: descOverride,
    }).then(() => { onMerged(); onClose(); })
      .catch(console.error)
      .finally(() => setBusy(false));
  };

  const DIFF_COLOR = { added: 'var(--green)', removed: '#f87171', reordered: '#4dabf7' } as const;
  const DIFF_SYM   = { added: '+', removed: '−', reordered: '↕' } as const;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}/>
      <MMSheet title={`Merge into ${targetBranch}`} subtitle={`${playlist.branches.length - 1} source branch${playlist.branches.length - 1 !== 1 ? 'es' : ''} · ${strategy}`} height="86%" expandable>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          <MField label="From branch">
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
          </MField>

          <MField label="Strategy">
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
          </MField>

          <MField label="Preview">
            <div style={{ borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', borderBottom: (previewRows.length > 0) ? '0.5px solid var(--border-0)' : 'none' }}>
                <DiffStat n={`+${added}`}   color={added > 0 ? 'var(--green)' : 'var(--text-2)'} sub="added"/>
                <DiffStat n={`−${removed}`} color={removed > 0 ? '#f87171' : 'var(--text-2)'}   sub="removed"/>
                <DiffStat n={`↕${reordered}`} color={reordered > 0 ? '#4dabf7' : 'var(--text-2)'} sub="reordered"/>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>→ {total} total</span>
              </div>
              {previewRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: i < previewRows.length - 1 ? '0.5px solid var(--border-0)' : 'none' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: DIFF_COLOR[row.kind], width: 12, textAlign: 'center', flexShrink: 0 }}>{DIFF_SYM[row.kind]}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                  {row.detail && <span style={{ fontSize: 11, color: '#4dabf7', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>{row.detail}</span>}
                </div>
              ))}
              {hiddenCount > 0 && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                  + {hiddenCount} more…
                </div>
              )}
            </div>
          </MField>

          {descConflict && (
            <MField label="Description conflict" hint="Branches differ. Pick one or write your own.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {([
                  { key: 'target' as const, label: `From ${targetBranch}`, value: targetDesc },
                  { key: 'source' as const, label: `From ${sourceBranch}`, value: sourceDesc },
                ] as { key: 'target' | 'source'; label: string; value: string | null }[]).map(opt => (
                  <button key={opt.key} onClick={() => setDescChoice(opt.key)} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10,
                    background: descChoice === opt.key ? 'oklch(0.25 0.08 28 / 0.6)' : 'var(--bg-3)',
                    border: `1px solid ${descChoice === opt.key ? 'var(--accent)' : 'var(--border-1)'}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 8, flexShrink: 0, marginTop: 2,
                      border: `2px solid ${descChoice === opt.key ? 'var(--accent)' : 'var(--border-2)'}`,
                      background: descChoice === opt.key ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {descChoice === opt.key && <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--bg-0)' }}/>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.1, marginBottom: 3 }}>{opt.label}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{opt.value ?? <em style={{ color: 'var(--text-3)' }}>no description</em>}</div>
                    </div>
                  </button>
                ))}
                <button onClick={() => setDescChoice('custom')} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10,
                  background: descChoice === 'custom' ? 'oklch(0.25 0.08 28 / 0.6)' : 'var(--bg-3)',
                  border: `1px solid ${descChoice === 'custom' ? 'var(--accent)' : 'var(--border-1)'}`,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, flexShrink: 0, marginTop: 2,
                    border: `2px solid ${descChoice === 'custom' ? 'var(--accent)' : 'var(--border-2)'}`,
                    background: descChoice === 'custom' ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {descChoice === 'custom' && <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--bg-0)' }}/>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.1, marginBottom: 3 }}>Write your own</div>
                    {descChoice === 'custom' && (
                      <textarea
                        value={customDesc}
                        onChange={e => setCustomDesc(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Enter merged description…"
                        rows={2}
                        style={{
                          width: '100%', background: 'var(--bg-4)', border: '0.5px solid var(--border-2)',
                          borderRadius: 6, padding: '6px 8px', color: 'var(--text-0)', fontSize: 13,
                          resize: 'none', fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                    )}
                  </div>
                </button>
              </div>
            </MField>
          )}

          <MField label="Commit message">
            <input
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder={`Merge ${sourceBranch} → ${targetBranch}`}
              style={{
                width: '100%', background: 'var(--bg-3)', border: '0.5px solid var(--border-1)',
                borderRadius: 10, padding: '10px 12px', color: 'var(--text-0)', fontSize: 13,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </MField>

          <div style={{ display: 'flex', gap: 8 }}>
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

const SHUFFLE_CYCLE = [ShuffleMode.Off, ShuffleMode.Smart, ShuffleMode.Random] as const;

// ── Main PlaylistDetail component
export function PlaylistDetail({ onBack, onTab }: { onBack: () => void; onTab: (id: TabId) => void }) {
  const currentPlaylistId  = useStore(s => s.currentPlaylistId);
  const currentBranchName  = useStore(s => s.currentBranchName);
  const setCurrentBranch   = useStore(s => s.setCurrentBranch);
  const setPlayingBranch   = useStore(s => s.setPlayingBranch);
  const playlists          = useStore(s => s.playlists);
  const loadPlaylists      = useStore(s => s.loadPlaylists);
  const loadedTrackHash    = useStore(s => s.loadedTrackHash);
  const setLoaded          = useStore(s => s.setLoaded);
  const setPlaying         = useStore(s => s.setPlaying);
  const loadQueue          = useStore(s => s.loadQueue);
  const shuffle            = useStore(s => s.shuffle);
  const setShuffle         = useStore(s => s.setShuffle);
  const queueTracks        = useStore(s => s.queueTracks);

  const playlist = playlists.find(p => p.id === currentPlaylistId) ?? null;
  const artUrl   = usePlaylistArtwork(currentPlaylistId, currentBranchName);

  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrackRecord[]>([]);
  const [tracksLoadingRaw, setTracksLoading] = useState(true);
  const tracksLoading = useMinDuration(tracksLoadingRaw);
  const [sheet, setSheet] = useState<'branch' | 'merge' | 'fork' | 'edit' | null>(null);
  const [showHistory, setShowHistory]       = useState(false);
  // Branch-specific description from live tree (may differ from SQL cache)
  const [liveDesc, setLiveDesc] = useState<string | null | undefined>(undefined);
  const [search, setSearch]                 = useState('');
  const [searchOpen, setSearchOpen]         = useState(false);
  const [forkToast, setForkToast]           = useState<string | null>(null);
  const searchInputRef                      = useRef<HTMLInputElement>(null);
  const toastTimerRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Fetch branch-specific description from live tree (SQL cache may be stale)
  useEffect(() => {
    if (!currentPlaylistId) return;
    setLiveDesc(undefined);
    invoke<{ name: string; description: string | null; artwork_hash: string | null }>(
      'playlist_get_meta', { playlistId: currentPlaylistId, branchName: currentBranchName }
    ).then(m => setLiveDesc(m.description))
     .catch(() => setLiveDesc(null));
  }, [currentPlaylistId, currentBranchName]);

  // autofocus search when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const showToast = (msg: string) => {
    setForkToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setForkToast(null), 2800);
  };

  if (!playlist) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        No playlist selected
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
    // Only now sync the playing branch to what's actually loaded
    setPlayingBranch(currentBranchName);
  };

  const handleShufflePress = () => {
    const currentIdx = SHUFFLE_CYCLE.indexOf(shuffle);
    const nextMode = SHUFFLE_CYCLE[(currentIdx + 1) % SHUFFLE_CYCLE.length];
    setShuffle(nextMode);
    // if queue isn't loaded from this playlist, load it first
    if (playlistTracks.length > 0) {
      const hashes = playlistTracks.map(t => t.hash);
      const queueMatchesPlaylist = queueTracks.length === hashes.length &&
        hashes.every((h, i) => queueTracks[i] === h);
      if (!queueMatchesPlaylist) {
        loadQueue(hashes);
      }
    }
  };

  const handleBranchSelect = (name: string) => {
    setCurrentBranch(name);
  };

  const handleRefresh = () => {
    loadPlaylists();
    loadTracks();
  };

  if (showHistory) {
    return (
      <div className="mobile-root">
        <CommitGraphView
          playlistId={playlist.id}
          branchName={currentBranchName}
          playlistName={playlist.name}
          branchNames={playlist.branches.map(b => b.name)}
          onBack={() => setShowHistory(false)}
          onRefresh={handleRefresh}
        />
      </div>
    );
  }

  const activeBranch = playlist.branches.find(b => b.name === currentBranchName)
    ?? playlist.branches[0];
  const pendingBranches = playlist.branches.filter(b => b.head_commit !== activeBranch?.head_commit).length;

  const filteredTracks = searchOpen && search.trim()
    ? playlistTracks.filter(t => {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      })
    : playlistTracks;

  const shuffleActive = shuffle !== ShuffleMode.Off;
  const ShuffleIcon = shuffle === ShuffleMode.Random ? Icons.shuffleRandom : Icons.shuffle;

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
            <button
              style={iconBtn(36)}
              onClick={() => {
                if (searchOpen) { setSearchOpen(false); setSearch(''); }
                else setSearchOpen(true);
              }}
            >
              {searchOpen
                ? <Icons.x size={18} stroke="var(--text-1)"/>
                : <Icons.search size={18} stroke="var(--text-1)"/>
              }
            </button>
          </div>
        </div>

        {/* search bar */}
        {searchOpen && (
          <div style={{ padding: '8px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)' }}>
              <Icons.search size={15} stroke="var(--text-3)"/>
              <input
                ref={searchInputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tracks…"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-0)', fontSize: 14 }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <Icons.x size={14} stroke="var(--text-3)"/>
                </button>
              )}
            </div>
          </div>
        )}

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

        {/* description — prefer live tree value, fall back to SQL cache */}
        {(liveDesc ?? playlist.description) && (
          <div style={{ padding: '4px 22px 0', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}>
            {liveDesc ?? playlist.description}
          </div>
        )}

        {/* play / shuffle */}
        <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => handlePlay(0)} style={{ flex: 1, padding: '12px 14px', borderRadius: 99, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', color: 'var(--bg-0)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 14, boxShadow: '0 8px 22px oklch(0.62 0.15 28 / 0.4)' }}>
            <Icons.play size={16}/> Play
          </button>
          <button
            onClick={handleShufflePress}
            style={{
              ...iconBtn(44),
              background: shuffleActive ? 'oklch(0.32 0.12 50 / 0.35)' : undefined,
              border: shuffleActive ? '1px solid var(--accent)' : undefined,
            }}
          >
            <ShuffleIcon size={20} stroke={shuffleActive ? 'var(--accent)' : 'var(--text-0)'}/>
          </button>
        </div>

        {/* action tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '8px 16px 14px' }}>
          <ActionTile Icon={Icons.fork} label="Fork" onPress={() => setSheet('fork')}/>
          <ActionTile
            Icon={Icons.merge} label="Merge"
            badge={pendingBranches > 0 ? String(pendingBranches) : undefined}
            onPress={() => setSheet('merge')}
          />
          <ActionTile Icon={Icons.history} label="History" onPress={() => setShowHistory(true)}/>
          <ActionTile Icon={Icons.gear} label="Edit" onPress={() => setSheet('edit')}/>
        </div>

        {/* tracks header */}
        <div style={{ padding: '4px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Tracks</h3>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
            {tracksLoading ? '…' : searchOpen && search.trim() ? `${filteredTracks.length} of ${playlistTracks.length}` : `${playlistTracks.length} · ${fmtTotalDuration(playlistTracks)}`}
          </span>
        </div>

        {tracksLoading && <MMLoader/>}

        {!tracksLoading && filteredTracks.length === 0 && (
          <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {searchOpen && search.trim() ? 'No tracks match your search.' : 'No tracks on this branch yet.'}
          </div>
        )}

        {!tracksLoading && filteredTracks.map((track, i) => (
          <TrackRow
            key={track.hash}
            track={track}
            idx={i}
            playing={track.hash === loadedTrackHash}
            onPlay={() => handlePlay(playlistTracks.indexOf(track))}
          />
        ))}

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="playlists" onTab={onTab}/>

      {/* fork toast */}
      {forkToast && (
        <div style={{
          position: 'absolute', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-5)', color: 'var(--text-0)', padding: '9px 18px',
          borderRadius: 99, fontSize: 13, fontWeight: 500, zIndex: 200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          border: '0.5px solid var(--border-2)',
        }}>
          {forkToast}
        </div>
      )}

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
      {sheet === 'fork' && (
        <ForkSheet
          playlist={playlist}
          onClose={() => setSheet(null)}
          onForked={(name) => {
            handleRefresh();
            showToast(`Forked to "${name}"`);
          }}
        />
      )}
      {sheet === 'edit' && (
        <EditSheet
          playlist={playlist}
          currentBranchName={currentBranchName}
          onClose={() => setSheet(null)}
          onSaved={() => handleRefresh()}
          onDeleted={() => onBack()}
        />
      )}
    </div>
  );
}
