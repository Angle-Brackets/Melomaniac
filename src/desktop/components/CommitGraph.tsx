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
    <div className="w-[200px] shrink-0 bg-mm-2 border-l border-mm-b0 p-3 overflow-y-auto styled-scroll">
      <div className="text-[9px] font-bold tracking-widest text-mm-t2 uppercase mb-2">Commit Detail</div>
      {([['Hash', selected.hash], ['Branch', selected.branch], ['Author', selected.author], ['Time', selected.time]] as const).map(([k, v]) => (
        <div key={k} className="mb-2">
          <div className="text-[9px] text-mm-t2 mb-0.5">{k}</div>
          <div className={`text-[11px] text-mm-t0 ${k === 'Hash' ? 'font-mono' : ''}`}>{v}</div>
        </div>
      ))}
      <div className="mb-2">
        <div className="text-[9px] text-mm-t2 mb-0.5">Message</div>
        <div className="text-[11px] text-mm-t0 leading-relaxed">{selected.msg}</div>
      </div>
      <div className="flex flex-col gap-1.5 mt-3">
        <button className="btn btn-ghost btn-xs border border-mm-b2 bg-mm-4 text-mm-accent-lit text-[10px]">
          ↩ Revert to this commit
        </button>
        <button onClick={onClose} className="btn btn-ghost btn-xs text-mm-t1 text-[10px]">
          ⎇ Checkout branch
        </button>
      </div>
    </div>
  );
}

function CommitList({ commits, selected, onSelect }: { commits: typeof COMMITS; selected: Commit | null; onSelect: (c: Commit | null) => void }) {
  return (
    <div className="flex-1 overflow-y-auto styled-scroll">
      {commits.map(c => {
        const isSel = selected?.hash === c.hash;
        const color = BRANCH_COLORS[c.branch] ?? 'var(--text-2)';
        return (
          <div key={c.hash} onClick={() => onSelect(isSel ? null : c)}
            className={`px-3.5 py-2.5 border-b border-mm-b0 cursor-pointer flex flex-col justify-center transition-colors duration-100 ${isSel ? 'bg-mm-4' : 'hover:bg-mm-3'}`}
            style={{ height: NODE_H }}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] rounded px-1.5 py-px" style={{ color, background: color + '18' }}>{c.hash}</span>
              {c.tags.map(t => (
                <span key={t} className="font-mono text-[9px] rounded px-1.5 py-px"
                  style={{
                    background: t === 'HEAD' ? 'var(--accent-dim)' : 'var(--bg-5)',
                    color: t === 'HEAD' ? 'var(--accent-light)' : 'var(--text-2)',
                  }}>{t}</span>
              ))}
              <span className="text-[10px] text-mm-t2 ml-auto">{c.time}</span>
            </div>
            <div className={`text-[12px] mt-0.5 ${isSel ? 'text-mm-t0 font-medium' : 'text-mm-t1'}`}>{c.msg}</div>
            <div className="text-[10px] text-mm-t2 mt-px">by {c.author}</div>
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
    <div className="shrink-0 overflow-y-auto bg-mm-0 styled-scroll" style={{ width: GRAPH_W }}>
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
    <div className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(8,6,4,0.82)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()}
        className="bg-mm-1 rounded-[10px] border border-mm-b2 flex flex-col overflow-hidden"
        style={{ width: 680, maxHeight: 560, boxShadow: '0 24px 60px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-mm-b0 shrink-0">
          <div>
            <div className="text-sm font-bold text-mm-t0">Study Beats — Commit History</div>
            <div className="text-[10px] text-mm-t2 font-mono mt-0.5">
              upstream/study-beats · {COMMITS.length} commits · 2 branches
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {Object.entries(BRANCH_COLORS).map(([b, c]) => (
              <div key={b} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span className="text-[10px] text-mm-t2 font-mono">{b}</span>
              </div>
            ))}
            <button onClick={onClose} className="btn btn-ghost btn-xs">Close</button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
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
    <div className="flex-1 flex overflow-hidden">
      <div className="shrink-0 overflow-y-auto bg-mm-0 border-r border-mm-b0 styled-scroll" style={{ width: GRAPH_W }}>
        <div className="px-2.5 py-2 flex gap-2">
          {Object.entries(BRANCH_COLORS).map(([b, c]) => (
            <div key={b} className="flex items-center gap-0.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
              <span className="text-[9px] text-mm-t2 font-mono">{b}</span>
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
