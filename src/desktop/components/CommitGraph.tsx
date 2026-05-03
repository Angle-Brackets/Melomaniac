import { useState } from 'react';
import { COMMITS, BRANCH_COLS, BRANCH_COLORS } from '../data';
import type { Commit } from '../data';

const NODE_H = 56;
const PAD_L = 40;
const COL_W = 22;
const GRAPH_W = 110;

function getPos(idx: number, branch: string) {
  return {
    x: PAD_L + (BRANCH_COLS[branch] ?? 0) * COL_W,
    y: 20 + idx * NODE_H,
  };
}

function buildLines(commits: typeof COMMITS) {
  const lines: JSX.Element[] = [];
  commits.forEach((c, i) => {
    const from = getPos(i, c.branch);
    c.parents.forEach(ph => {
      const pi = commits.findIndex(x => x.hash === ph);
      if (pi === -1) return;
      const to = getPos(pi, commits[pi].branch);
      const curved = from.x !== to.x;
      lines.push(
        <path key={`${c.hash}-${ph}`}
          d={curved
            ? `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`
            : `M ${from.x} ${from.y} L ${to.x} ${to.y}`}
          stroke={BRANCH_COLORS[c.branch] ?? 'var(--text-2)'}
          strokeWidth="1.5" fill="none" opacity="0.5"
          strokeDasharray={curved ? '3 2' : undefined}
        />
      );
    });
  });
  return lines;
}

function CommitDetail({ selected, onClose }: { selected: Commit; onClose: () => void }) {
  return (
    <div style={{
      width: 200, flexShrink: 0, background: 'var(--bg-2)',
      borderLeft: '1px solid var(--border-0)', padding: '12px',
      overflowY: 'auto',
    }} className="styled-scroll">
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 8 }}>Commit Detail</div>
      {([['Hash', selected.hash], ['Branch', selected.branch], ['Author', selected.author], ['Time', selected.time]] as const).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-2)', marginBottom: 2 }}>{k}</div>
          <div style={{ fontSize: 11, color: 'var(--text-0)', fontFamily: k === 'Hash' ? "'JetBrains Mono', monospace" : 'inherit' }}>{v}</div>
        </div>
      ))}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: 'var(--text-2)', marginBottom: 2 }}>Message</div>
        <div style={{ fontSize: 11, color: 'var(--text-0)', lineHeight: 1.5 }}>{selected.msg}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
        <button style={{ padding: '5px', borderRadius: 4, border: '1px solid var(--border-2)', background: 'var(--bg-4)', color: 'var(--accent-light)', fontSize: 10, cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}>
          ↩ Revert to this commit
        </button>
        <button onClick={onClose} style={{ padding: '5px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'transparent', color: 'var(--text-1)', fontSize: 10, cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}>
          ⎇ Checkout branch
        </button>
      </div>
    </div>
  );
}

function CommitList({ commits, selected, onSelect }: { commits: typeof COMMITS; selected: Commit | null; onSelect: (c: Commit | null) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
      {commits.map(c => {
        const isSel = selected?.hash === c.hash;
        const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
        return (
          <div key={c.hash} onClick={() => onSelect(isSel ? null : c)}
            style={{
              padding: '10px 14px', height: NODE_H,
              borderBottom: '1px solid var(--border-0)',
              background: isSel ? 'var(--bg-4)' : 'transparent',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
            onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color, background: color + '18', padding: '1px 6px', borderRadius: 3 }}>{c.hash}</span>
              {c.tags.map(t => (
                <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: t === 'HEAD' ? 'var(--accent-dim)' : 'var(--bg-5)', color: t === 'HEAD' ? 'var(--accent-light)' : 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{t}</span>
              ))}
              <span style={{ fontSize: 10, color: 'var(--text-2)', marginLeft: 'auto' }}>{c.time}</span>
            </div>
            <div style={{ fontSize: 12, color: isSel ? 'var(--text-0)' : 'var(--text-1)', marginTop: 3, fontWeight: isSel ? 500 : 400 }}>{c.msg}</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 1 }}>by {c.author}</div>
          </div>
        );
      })}
    </div>
  );
}

function SvgGraph({ commits, selected, onSelect }: { commits: typeof COMMITS; selected: Commit | null; onSelect: (c: Commit) => void }) {
  const totalH = commits.length * NODE_H + 20;
  const lines = buildLines(commits);
  return (
    <div style={{ width: GRAPH_W, flexShrink: 0, overflowY: 'auto', background: 'var(--bg-0)' }} className="styled-scroll">
      <svg width={GRAPH_W} height={totalH} style={{ display: 'block' }}>
        {lines}
        {commits.map((c, i) => {
          const { x, y } = getPos(i, c.branch);
          const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
          const isSel = selected?.hash === c.hash;
          return (
            <g key={c.hash} style={{ cursor: 'pointer' }} onClick={() => onSelect(c)}>
              <circle cx={x} cy={y} r={isSel ? 8 : 6}
                fill={isSel ? color : 'var(--bg-2)'}
                stroke={color} strokeWidth={isSel ? 2.5 : 1.5} />
              {c.tags.includes('HEAD') && (
                <circle cx={x} cy={y} r={11} fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Overlay modal version ──────────────────────────────────────────────────────
export function CommitGraph({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<Commit | null>(null);

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(8,6,4,0.82)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 680, maxHeight: 560,
        background: 'var(--bg-1)', borderRadius: 10,
        border: '1px solid var(--border-2)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-0)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Study Beats — Commit History</div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              upstream/study-beats · {COMMITS.length} commits · 2 branches
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {Object.entries(BRANCH_COLORS).map(([b, c]) => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{b}</span>
              </div>
            ))}
            <button onClick={onClose} style={{
              background: 'var(--bg-3)', border: '1px solid var(--border-1)',
              borderRadius: 5, color: 'var(--text-1)', fontSize: 11,
              padding: '3px 10px', cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
            }}>Close</button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <SvgGraph commits={COMMITS} selected={selected} onSelect={setSelected} />
          <CommitList commits={COMMITS} selected={selected} onSelect={setSelected} />
          {selected && <CommitDetail selected={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  );
}

// ── Inline version (for History tab) ─────────────────────────────────────────
export function CommitGraphInline() {
  const [selected, setSelected] = useState<Commit | null>(null);
  const totalH = COMMITS.length * NODE_H + 20;
  const lines = buildLines(COMMITS);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: GRAPH_W, flexShrink: 0, overflowY: 'auto', background: 'var(--bg-0)', borderRight: '1px solid var(--border-0)' }} className="styled-scroll">
        <div style={{ padding: '8px 10px', display: 'flex', gap: 8 }}>
          {Object.entries(BRANCH_COLORS).map(([b, c]) => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />
              <span style={{ fontSize: 9, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{b}</span>
            </div>
          ))}
        </div>
        <svg width={GRAPH_W} height={totalH} style={{ display: 'block' }}>
          {lines}
          {COMMITS.map((c, i) => {
            const { x, y } = getPos(i, c.branch);
            const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
            const isSel = selected?.hash === c.hash;
            return (
              <g key={c.hash} style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                <circle cx={x} cy={y} r={isSel ? 8 : 6}
                  fill={isSel ? color : 'var(--bg-2)'}
                  stroke={color} strokeWidth={isSel ? 2.5 : 1.5} />
                {c.tags.includes('HEAD') && (
                  <circle cx={x} cy={y} r={11} fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <CommitList commits={COMMITS} selected={selected} onSelect={setSelected} />
      {selected && <CommitDetail selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
