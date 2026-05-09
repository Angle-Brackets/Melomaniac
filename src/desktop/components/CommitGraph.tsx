import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PlaylistRecord } from '../data';
import { FiGitBranch, FiRefreshCw } from 'react-icons/fi';
import { IcoClose } from '../icons';
import { Select } from './Select';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GraphNode {
  hash:      string;
  tree_hash: string;
  timestamp: number;
  device_id: string;
  message:   string | null;
  parents:   string[];
  refs:      string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_H = 50;
const LANE_W = 16;
const DOT_R  = 4;
const LINE_W = 1.5;

const PALETTE = [
  'var(--accent-light)',
  '#4dabf7',
  '#69db7c',
  '#ffa94d',
  '#da77f2',
  '#f783ac',
  '#a9e34b',
  '#63e6be',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Cubic-bezier path: vertical for straight lines, S-curve for diagonals
function makePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1},${y1} L${x1},${y2}`;
  const cy = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts * 1000;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function shortHash(h: string) { return h.slice(0, 7); }
function laneCol(i: number)   { return PALETTE[i % PALETTE.length]; }
function lx(lane: number)     { return lane * LANE_W + LANE_W / 2; }

// ── Layout algorithm ──────────────────────────────────────────────────────────

interface SvgLine { x1: number; y1: number; x2: number; y2: number; col: string; lane: number; }

interface RowLayout {
  commit:  GraphNode;
  lane:    number;
  color:   string;
  svgW:    number;
  lines:   SvgLine[];
  dotCx:   number;
  dotCy:   number;
}

function computeLayout(commits: GraphNode[]): RowLayout[] {
  const lanes:  Array<string | null> = [];
  const colors: string[] = [];
  const HALF = NODE_H / 2;

  // Reserve lane 0 for the main branch tip so it keeps the primary color even
  // when a newer branch tip appears first in timestamp order. Only applies in
  // true fork scenarios — if main's HEAD is the direct first-parent of another
  // commit it's a linear history and no reservation is needed.
  const mainTip = commits.find(c => c.refs.includes('main'));
  const mainTipHash = mainTip?.hash ?? null;
  const mainIsDirect = mainTipHash !== null &&
    commits.some(c => c.parents[0] === mainTipHash);
  let mainPlaced = mainTipHash === null || mainIsDirect;

  const alloc = (hash: string): number => {
    if (hash === mainTipHash && !mainPlaced) {
      // Give main lane 0 on first sight
      mainPlaced = true;
      while (lanes.length === 0) lanes.push(null);
      lanes[0]  = hash;
      colors[0] = laneCol(0);
      return 0;
    }
    // Skip lane 0 while it's still reserved for main
    const start = !mainPlaced ? 1 : 0;
    for (let i = start; ; i++) {
      while (i >= lanes.length) { lanes.push(null); }
      if (lanes[i] === null) {
        lanes[i]  = hash;
        colors[i] = laneCol(i);
        return i;
      }
    }
  };

  return commits.map(commit => {
    // Locate or allocate lane
    let myLane  = lanes.indexOf(commit.hash);
    const isNew = myLane === -1;
    if (isNew) myLane = alloc(commit.hash);

    const myColor = colors[myLane];

    // Snapshot before clearing
    const before = [...lanes];
    before[myLane] = commit.hash;

    // Free this slot
    lanes[myLane] = null;

    // Assign parent lanes
    const parentLanes: { lane: number }[] = [];
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const p  = commit.parents[pi];
      const ex = lanes.indexOf(p);
      if (ex !== -1) {
        parentLanes.push({ lane: ex });
      } else if (pi === 0) {
        lanes[myLane] = p;
        parentLanes.push({ lane: myLane });
      } else {
        parentLanes.push({ lane: alloc(p) });
      }
    }

    const after = [...lanes];

    // Build SVG lines
    const lines: SvgLine[] = [];
    const maxIdx = Math.max(before.length, after.length, myLane + 1);

    for (let i = 0; i < maxIdx; i++) {
      if (i === myLane) continue;
      const hB = before[i] ?? null;
      const hA = after[i]  ?? null;
      const c  = colors[i] ?? laneCol(i);
      // Continuation: passes through unchanged
      if (hB && hA && hB === hA) lines.push({ x1: lx(i), y1: 0, x2: lx(i), y2: NODE_H, col: c, lane: i });
      // Lane ends here (edge case: lane consumed mid-row)
      else if (hB && !hA)        lines.push({ x1: lx(i), y1: 0, x2: lx(i), y2: HALF,   col: c, lane: i });
      // Note: !hB && hA is handled by parent lines below, not here
    }

    // Incoming line to circle (top half)
    if (!isNew) lines.push({ x1: lx(myLane), y1: 0, x2: lx(myLane), y2: HALF, col: myColor, lane: myLane });

    // Outgoing lines to parents (bottom half).
    // First parent continues in this commit's color; additional parents (merge sources)
    // use the source lane's color so the branch line stays its own color up to the diamond.
    for (let pi = 0; pi < parentLanes.length; pi++) {
      const p = parentLanes[pi];
      const lineCol = pi === 0 ? myColor : (colors[p.lane] ?? myColor);
      lines.push({ x1: lx(myLane), y1: HALF, x2: lx(p.lane), y2: NODE_H, col: lineCol, lane: myLane });
    }

    const maxLane = Math.max(
      myLane,
      before.reduce((m, v, i) => v ? Math.max(m, i) : m, 0),
      after.reduce( (m, v, i) => v ? Math.max(m, i) : m, 0),
      ...parentLanes.map(p => p.lane),
    );

    return {
      commit,
      lane:  myLane,
      color: myColor,
      svgW:  (maxLane + 1) * LANE_W + LANE_W / 2,
      lines,
      dotCx: lx(myLane),
      dotCy: HALF,
    };
  });
}

// Walk backwards from a HEAD hash, returning only reachable commits
function filterToHead(nodes: GraphNode[], headHash: string): GraphNode[] {
  const map = new Map(nodes.map(n => [n.hash, n]));
  const seen = new Set<string>();
  const q = [headHash];
  while (q.length) {
    const h = q.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    map.get(h)?.parents.forEach(p => q.push(p));
  }
  return nodes.filter(n => seen.has(n.hash));
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailProps {
  row:             RowLayout;
  playlistId:      string;
  branchName:      string;
  onClose:         () => void;
  onBranchCreated: (name: string, pid: string) => void;
  onRevertTo:      (hash: string, pid: string) => void;
}

function CommitDetail({ row, playlistId, branchName, onClose, onBranchCreated, onRevertTo }: DetailProps) {
  const { commit, color } = row;
  const [newBranch, setNewBranch] = useState('');
  const [branching, setBranching] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [err,       setErr]       = useState<string | null>(null);

  const handleBranch = async () => {
    if (!newBranch.trim()) return;
    setBranching(true); setErr(null);
    try {
      await invoke('branch_create', { playlistId, name: newBranch.trim(), fromCommit: commit.hash });
      onBranchCreated(newBranch.trim(), playlistId);
      setNewBranch('');
    } catch (e) { setErr(String(e)); }
    finally     { setBranching(false); }
  };

  const handleRevert = async () => {
    setReverting(true); setErr(null);
    try {
      await invoke('branch_revert_to', {
        playlistId, branchName,
        commitHash: commit.hash,
        message:    `Revert to ${shortHash(commit.hash)}`,
      });
      onRevertTo(commit.hash, playlistId);
    } catch (e) { setErr(String(e)); }
    finally     { setReverting(false); }
  };

  return (
    <div style={{
      width: 230, flexShrink: 0,
      background: 'var(--bg-1)', borderLeft: '1px solid var(--border-0)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border-0)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-2)', flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
          padding: '2px 6px', borderRadius: 4,
          background: color + '22', color,
        }}>
          {shortHash(commit.hash)}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
          <IcoClose size={13} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={labelStyle}>Message</div>
          <div style={{ fontSize: 12, color: 'var(--text-0)', lineHeight: 1.5, fontFamily: "'Outfit', sans-serif", whiteSpace: 'pre-wrap' }}>
            {commit.message ?? <em style={{ color: 'var(--text-3)' }}>no message</em>}
          </div>
        </div>

        {([['Author', commit.device_id], ['Time', new Date(commit.timestamp * 1000).toLocaleString()], ['Tree', shortHash(commit.tree_hash)]] as [string, string][]).map(([k, v]) => (
          <div key={k}>
            <div style={labelStyle}>{k}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: k === 'Tree' ? "'JetBrains Mono', monospace" : undefined }}>{v}</div>
          </div>
        ))}

        {commit.refs.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {commit.refs.map(r => (
              <span key={r} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--accent-light)' }}>
                ⎇ {r}
              </span>
            ))}
          </div>
        )}

        <div style={{ height: 1, background: 'var(--border-0)', flexShrink: 0 }} />

        {/* Branch from here */}
        <div>
          <div style={labelStyle}>Branch from here</div>
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleBranch()}
              placeholder="branch-name"
              style={{ flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-1)', borderRadius: 4, padding: '4px 7px', fontSize: 11, outline: 'none', color: 'var(--text-0)', fontFamily: "'JetBrains Mono', monospace" }}
            />
            <button
              onClick={handleBranch}
              disabled={branching || !newBranch.trim()}
              style={{ padding: '4px 9px', borderRadius: 4, fontSize: 11, background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent-light)', cursor: branching || !newBranch.trim() ? 'not-allowed' : 'pointer', opacity: branching || !newBranch.trim() ? 0.5 : 1 }}
            >⎇</button>
          </div>
        </div>

        {/* Revert */}
        <button
          onClick={handleRevert}
          disabled={reverting}
          style={{ padding: '6px', borderRadius: 4, border: '1px solid var(--border-2)', background: 'var(--bg-3)', fontSize: 11, color: 'var(--text-1)', cursor: reverting ? 'not-allowed' : 'pointer', opacity: reverting ? 0.6 : 1, fontFamily: "'Outfit', sans-serif" }}
        >
          {reverting ? 'Reverting…' : `↩ Revert branch to here`}
        </button>

        {err && <p style={{ fontSize: 10, color: '#f87171', fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>✗ {err}</p>}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3,
};

// ── Graph panel ───────────────────────────────────────────────────────────────

interface GraphPanelProps {
  initPlaylistId:  string | null;
  initBranch:      string;
  refreshKey?:     number;
  onBranchCreated: (name: string, pid: string) => void;
  onRevertTo:      (hash: string, pid: string) => void;
}

function GraphPanel({ initPlaylistId, initBranch, refreshKey, onBranchCreated, onRevertTo }: GraphPanelProps) {
  const [playlists,   setPlaylists]   = useState<PlaylistRecord[]>([]);
  const [selPid,      setSelPid]      = useState<string | null>(initPlaylistId);
  const [selBranch,   setSelBranch]   = useState<string>('all');
  const [allNodes,    setAllNodes]    = useState<GraphNode[]>([]);
  const [layout,      setLayout]      = useState<RowLayout[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [selected,    setSelected]    = useState<{ row: RowLayout; idx: number } | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const effectiveRefresh = (refreshKey ?? 0) + localRefresh;

  // Sync when parent changes active playlist
  useEffect(() => { setSelPid(initPlaylistId); setSelBranch('all'); setSelected(null); }, [initPlaylistId]);
  useEffect(() => { if (initBranch) setSelBranch(initBranch); }, [initBranch]);

  // Load playlists
  useEffect(() => {
    invoke<PlaylistRecord[]>('playlist_get_all').then(setPlaylists).catch(console.error);
  }, [effectiveRefresh]);

  // Auto-select first playlist when none chosen
  useEffect(() => {
    if (!selPid && playlists.length > 0) setSelPid(playlists[0].id);
  }, [selPid, playlists]);

  // Load graph data
  useEffect(() => {
    if (!selPid) { setAllNodes([]); setLayout([]); return; }
    setLoading(true);
    invoke<GraphNode[]>('playlist_get_graph', { playlistId: selPid })
      .then(setAllNodes)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selPid, effectiveRefresh]);

  // Recompute layout when data or branch filter changes
  useEffect(() => {
    if (!allNodes.length) { setLayout([]); return; }

    let filtered = allNodes;
    if (selBranch !== 'all') {
      const branch = playlists.find(p => p.id === selPid)?.branches.find(b => b.name === selBranch);
      if (branch?.head_commit) filtered = filterToHead(allNodes, branch.head_commit);
    }
    setLayout(computeLayout(filtered));
    setSelected(null);
  }, [allNodes, selBranch, selPid, playlists]);

  const curPlaylist = playlists.find(p => p.id === selPid) ?? null;
  const svgMaxW     = Math.max(LANE_W * 2, ...layout.map(r => r.svgW));

  const activeBranchForDetail =
    selBranch !== 'all' ? selBranch : (curPlaylist?.branches[0]?.name ?? 'main');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border-0)', background: 'var(--bg-2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap' }}>Playlist</span>
          <Select
            size="sm"
            value={selPid ?? ''}
            options={playlists.length === 0
              ? [{ value: '', label: 'No playlists' }]
              : playlists.map(p => ({ value: p.id, label: p.name }))}
            onChange={v => { setSelPid(v || null); setSelBranch('all'); }}
            placeholder="Select playlist"
            disabled={playlists.length === 0}
          />
        </div>

        {curPlaylist && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <FiGitBranch size={10} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <Select
              size="sm"
              mono
              value={selBranch}
              options={[
                { value: 'all', label: 'All branches' },
                ...curPlaylist.branches.map(b => ({ value: b.name, label: b.name })),
              ]}
              onChange={setSelBranch}
              accentColor={selBranch === 'all' ? null : 'var(--accent-light)'}
            />
          </div>
        )}

        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
          {loading ? 'Loading…' : layout.length > 0 ? `${layout.length} commit${layout.length !== 1 ? 's' : ''}` : ''}
        </span>
        <button
          onClick={() => setLocalRefresh(n => n + 1)}
          title="Refresh"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', padding: '2px 4px', display: 'flex', alignItems: 'center',
            borderRadius: 3, transition: 'color 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
        >
          <FiRefreshCw size={11} style={loading ? { animation: 'spin 0.7s linear infinite' } : {}} />
        </button>
      </div>

      {/* Body */}
      {!selPid ? (
        <div style={emptyStyle}>Select a playlist to view history</div>
      ) : !loading && layout.length === 0 ? (
        <div style={emptyStyle}>No commits yet</div>
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Commit list */}
          <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
            {layout.map((row, i) => {
              const isSel = selected?.idx === i;
              return (
                <div
                  key={row.commit.hash}
                  onClick={() => setSelected(isSel ? null : { row, idx: i })}
                  className={isSel ? '' : 'hover:bg-[var(--bg-3)]'}
                  style={{
                    height: NODE_H, display: 'flex', alignItems: 'stretch',
                    borderBottom: '1px solid var(--border-0)', cursor: 'pointer',
                    background: isSel ? 'var(--bg-4)' : undefined,
                    transition: 'background 0.12s',
                  }}
                >
                  {/* Graph column */}
                  <div style={{ width: svgMaxW, flexShrink: 0 }}>
                    <svg width={svgMaxW} height={NODE_H} style={{ overflow: 'visible' }}>
                      {row.lines.map((l, j) => (
                        <path
                          key={j}
                          d={makePath(l.x1, l.y1, l.x2, l.y2)}
                          stroke={l.col}
                          strokeWidth={LINE_W}
                          fill="none"
                          strokeLinecap="round"
                        />
                      ))}
                      {row.commit.parents.length > 1 ? (
                        <rect
                          x={row.dotCx - DOT_R * 0.9} y={row.dotCy - DOT_R * 0.9}
                          width={DOT_R * 1.8} height={DOT_R * 1.8}
                          transform={`rotate(45,${row.dotCx},${row.dotCy})`}
                          fill={row.color}
                          stroke={isSel ? '#fff' : 'var(--bg-1)'}
                          strokeWidth={isSel ? 2 : 1.5}
                          style={{ filter: isSel ? `drop-shadow(0 0 5px ${row.color})` : undefined }}
                        />
                      ) : (
                        <circle
                          cx={row.dotCx} cy={row.dotCy}
                          r={isSel ? DOT_R + 1.5 : DOT_R}
                          fill={row.color}
                          stroke={isSel ? '#fff' : 'var(--bg-1)'}
                          strokeWidth={isSel ? 2 : 1.5}
                          style={{ filter: isSel ? `drop-shadow(0 0 5px ${row.color})` : undefined }}
                        />
                      )}
                    </svg>
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0, padding: '0 10px 0 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <span className="badge badge-xs font-mono" style={{ background: row.color + '25', color: row.color, border: 'none', flexShrink: 0, fontSize: 9 }}>
                        {shortHash(row.commit.hash)}
                      </span>
                      {row.commit.parents.length > 1 && (
                        <span className="badge badge-xs" style={{ background: 'var(--bg-5)', color: 'var(--text-2)', border: 'none', flexShrink: 0, fontSize: 8, fontFamily: "'Outfit', sans-serif" }}>
                          ⋈ merge
                        </span>
                      )}
                      {row.commit.refs.map(ref => (
                        <span key={ref} className="badge badge-xs font-mono" style={{ background: 'var(--accent-dim)', color: 'var(--accent-light)', border: 'none', flexShrink: 0, fontSize: 8 }}>
                          ⎇ {ref}
                        </span>
                      ))}
                      <span className="font-mono" style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>
                        {fmtTime(row.commit.timestamp)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: isSel ? 'var(--text-0)' : 'var(--text-1)', fontFamily: "'Outfit', sans-serif", fontWeight: isSel ? 600 : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.commit.message ?? <em style={{ color: 'var(--text-3)' }}>no message</em>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          {selected && selPid && (
            <CommitDetail
              row={selected.row}
              playlistId={selPid}
              branchName={activeBranchForDetail}
              onClose={() => setSelected(null)}
              onBranchCreated={(name, pid) => {
                invoke<PlaylistRecord[]>('playlist_get_all').then(setPlaylists).catch(console.error);
                onBranchCreated(name, pid);
                setSelected(null);
                // Refresh graph
                invoke<GraphNode[]>('playlist_get_graph', { playlistId: selPid })
                  .then(setAllNodes).catch(console.error);
              }}
              onRevertTo={(hash, pid) => {
                onRevertTo(hash, pid);
                setSelected(null);
                invoke<GraphNode[]>('playlist_get_graph', { playlistId: selPid })
                  .then(setAllNodes).catch(console.error);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif",
};

// ── Public exports ─────────────────────────────────────────────────────────────

export interface CommitGraphInlineProps {
  playlistId:      string | null;
  branchName:      string;
  refreshKey?:     number;
  onBranchCreated: (name: string, playlistId: string) => void;
  onRevertTo:      (hash: string, playlistId: string) => void;
}

export function CommitGraphInline({ playlistId, branchName, refreshKey, onBranchCreated, onRevertTo }: CommitGraphInlineProps) {
  return (
    <GraphPanel
      initPlaylistId={playlistId}
      initBranch={branchName}
      refreshKey={refreshKey}
      onBranchCreated={onBranchCreated}
      onRevertTo={onRevertTo}
    />
  );
}

export function CommitGraph({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,6,4,0.82)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '85vw', height: '80vh', maxWidth: 920, maxHeight: 660, background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border-2)', boxShadow: '0 24px 60px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>Commit History</span>
          <button onClick={onClose} style={{ padding: '4px 12px', background: 'var(--bg-4)', border: '1px solid var(--border-2)', borderRadius: 4, fontSize: 11, color: 'var(--text-1)', cursor: 'pointer' }}>Close</button>
        </div>
        <GraphPanel
          initPlaylistId={null}
          initBranch="all"
          onBranchCreated={() => {}}
          onRevertTo={() => {}}
        />
      </div>
    </div>
  );
}
