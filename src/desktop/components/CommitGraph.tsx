import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommitRecord {
  hash:      string;
  tree_hash: string;
  timestamp: number;
  device_id: string;
  message:   string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_H = 54;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortHash(h: string) { return h.slice(0, 7); }

// ── Sub-components ────────────────────────────────────────────────────────────

function CommitDetail({ commit, onClose }: { commit: CommitRecord; onClose: () => void }) {
  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg-2)', borderLeft: '1px solid var(--border-0)',
      padding: 14, overflowY: 'auto',
      fontFamily: "'Outfit', sans-serif",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10 }}>
        Commit Detail
      </div>
      {([
        ['Hash',      shortHash(commit.hash)],
        ['Tree',      shortHash(commit.tree_hash)],
        ['Author',    commit.device_id],
        ['Time',      new Date(commit.timestamp * 1000).toLocaleString()],
      ] as [string, string][]).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--text-2)', marginBottom: 2 }}>{k}</div>
          <div style={{ fontSize: 11, color: 'var(--text-0)', fontFamily: k === 'Hash' || k === 'Tree' ? "'JetBrains Mono', monospace" : undefined }}>
            {v}
          </div>
        </div>
      ))}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: 'var(--text-2)', marginBottom: 2 }}>Message</div>
        <div style={{ fontSize: 11, color: 'var(--text-0)', lineHeight: 1.5 }}>
          {commit.message ?? '(no message)'}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          marginTop: 4, width: '100%', padding: '5px 0',
          background: 'var(--bg-4)', border: '1px solid var(--border-2)',
          borderRadius: 4, fontSize: 10, color: 'var(--text-1)', cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function CommitList({ commits, selected, onSelect }: {
  commits:  CommitRecord[];
  selected: CommitRecord | null;
  onSelect: (c: CommitRecord | null) => void;
}) {
  if (commits.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif" }}>
          No commits yet — edit a track to create the first one
        </span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
      {commits.map((c, i) => {
        const isSel = selected?.hash === c.hash;
        const isFirst = i === 0;
        return (
          <div
            key={c.hash}
            onClick={() => onSelect(isSel ? null : c)}
            style={{
              height: NODE_H,
              padding: '0 14px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              borderBottom: '1px solid var(--border-0)',
              cursor: 'pointer',
              background: isSel ? 'var(--bg-4)' : undefined,
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
            onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = ''; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                padding: '1px 5px', borderRadius: 3,
                background: 'var(--accent-dim)', color: 'var(--accent-light)',
              }}>
                {shortHash(c.hash)}
              </span>
              {isFirst && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                  padding: '1px 5px', borderRadius: 3,
                  background: 'var(--bg-5)', color: 'var(--text-2)',
                }}>
                  HEAD
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-2)', marginLeft: 'auto', flexShrink: 0 }}>
                {fmtTime(c.timestamp)}
              </span>
            </div>
            <div style={{
              fontSize: 12, marginTop: 3,
              color: isSel ? 'var(--text-0)' : 'var(--text-1)',
              fontFamily: "'Outfit', sans-serif",
              fontWeight: isSel ? 600 : undefined,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {c.message ?? '(no message)'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
              {c.device_id}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

function useRecentCommits(limit = 200) {
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<CommitRecord[]>('get_recent_commits', { limit })
      .then(setCommits)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [limit]);

  return { commits, loading };
}

// ── Overlay modal version ──────────────────────────────────────────────────────
export function CommitGraph({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<CommitRecord | null>(null);
  const { commits, loading } = useRecentCommits();

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8,6,4,0.82)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 680, maxHeight: 560,
          background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--border-0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              Commit History
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              {loading ? 'Loading…' : `${commits.length} commits · all branches`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ padding: '4px 12px', background: 'var(--bg-4)', border: '1px solid var(--border-2)', borderRadius: 4, fontSize: 11, color: 'var(--text-1)', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <CommitList commits={commits} selected={selected} onSelect={setSelected} />
          {selected && <CommitDetail commit={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  );
}

// ── Inline version (for History tab) ─────────────────────────────────────────
export function CommitGraphInline({ refreshKey }: { refreshKey?: number }) {
  const [selected, setSelected] = useState<CommitRecord | null>(null);
  const [commits,  setCommits]  = useState<CommitRecord[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<CommitRecord[]>('get_recent_commits', { limit: 200 })
      .then(setCommits)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif" }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <CommitList commits={commits} selected={selected} onSelect={setSelected} />
      {selected && <CommitDetail commit={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
