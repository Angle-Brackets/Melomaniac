import { useState } from 'react';
import { CHART_BARS, CHART_LINE } from '../data';

function MiniBarChart({ data, color = 'var(--accent-dim)' }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, marginTop: 4 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${(v / max) * 100}%`,
          background: color,
          borderRadius: '1px 1px 0 0',
          minHeight: 2,
          opacity: 0.7 + (v / max) * 0.3,
        }} />
      ))}
    </div>
  );
}

function MiniLineChart({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const W = 100, H = 32;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - ((v - min) / range) * (H - 4) - 2,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const fill = `${d} L ${pts[pts.length - 1][0]} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 32, marginTop: 4, display: 'block' }}>
      <defs>
        <linearGradient id="lgf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lgf)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface RightPanelProps {
  vibeText: string;
  onVibeChange: (v: string) => void;
  onCollapse: () => void;
}

const rpLabel: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
  color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6,
};

const CONNECTIONS = [
  { name: 'Spotify Premium', status: 'Connected',  color: '#1db954', dot: true },
  { name: 'Last.fm',         status: 'Connect…',   color: '#d51007', dot: false },
  { name: 'Upstream Remote', status: 'Up-to-Date', color: 'var(--green)', dot: true },
];

export default function RightPanel({ vibeText, onVibeChange, onCollapse }: RightPanelProps) {
  const [generating, setGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!vibeText.trim()) return;
    setGenerating(true);
    setAiResult(null);
    try {
      await new Promise(res => setTimeout(res, 1200));
      setAiResult(
        `Playlist: ${vibeText.split(' ').slice(0, 2).join(' ')} Hues\n` +
        `1. Still Waters — Nils Frahm\n` +
        `2. Comptine d'un Autre Été — Yann Tiersen\n` +
        `3. Experience — Ludovico Einaudi\n` +
        `4. Divenire — Ludovico Einaudi`
      );
    } catch {
      setAiResult('Could not connect to AI.');
    }
    setGenerating(false);
  };

  return (
    <div style={{
      width: 220, background: 'var(--bg-1)',
      borderLeft: '1px solid var(--border-0)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{
        padding: '8px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        color: 'var(--text-2)', textTransform: 'uppercase',
        borderBottom: '1px solid var(--border-0)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Melomaniac AI & Metrics</span>
        <span style={{ color: 'var(--border-2)', cursor: 'pointer', fontSize: 11 }} onClick={onCollapse}>›</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }} className="styled-scroll">

        {/* AI vibe section */}
        <div style={{ marginBottom: 14 }}>
          <div style={rpLabel}>1. Describe your vibe…</div>
          <textarea
            value={vibeText}
            onChange={e => onVibeChange(e.target.value)}
            placeholder="chill ambient music for focus"
            style={{
              width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border-1)',
              borderRadius: 5, padding: '6px 8px', fontSize: 11, color: 'var(--text-1)',
              fontFamily: "'Outfit', sans-serif", resize: 'none', outline: 'none',
              minHeight: 48, transition: 'border-color 0.15s', boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent-dim)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-1)')}
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              marginTop: 5, width: '100%', padding: '6px 0',
              background: 'var(--bg-4)', border: '1px solid var(--border-2)',
              borderRadius: 5, fontSize: 11, color: generating ? 'var(--text-2)' : 'var(--accent-light)',
              cursor: generating ? 'wait' : 'pointer', fontFamily: "'Outfit', sans-serif",
              transition: 'all 0.15s',
            }}
          >{generating ? 'Generating…' : "Generate Playlist"}</button>

          {aiResult && (
            <div style={{
              marginTop: 8, padding: '8px', background: 'var(--bg-3)',
              borderRadius: 5, border: '1px solid var(--border-1)',
              fontSize: 10, color: 'var(--text-1)', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace",
            }}>{aiResult}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
              Gemma 4 (Local AI) <span style={{ color: 'var(--green)' }}>Active</span>
            </span>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border-0)', margin: '0 0 12px' }} />

        {/* Stats */}
        <div style={{ marginBottom: 14 }}>
          <div style={rpLabel}>2. Your Stats</div>
          <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 6 }}>
            Listen time · most played artist · top playlist
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-0)', borderRadius: 5, padding: '6px 7px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-2)' }}>Play time</div>
              <MiniLineChart data={CHART_LINE} color="var(--accent)" />
            </div>
            <div style={{ flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-0)', borderRadius: 5, padding: '6px 7px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-2)' }}>Skips</div>
              <MiniBarChart data={CHART_BARS} color="var(--accent-dim)" />
            </div>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
            {([['4h 22m', 'This week'], ['Anna Bair', 'Top artist'], ['Study Beats', 'Top playlist']] as const).map(([v, l]) => (
              <div key={l} style={{
                flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-0)',
                borderRadius: 4, padding: '5px 5px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
                <div style={{ fontSize: 9, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border-0)', margin: '0 0 12px' }} />

        {/* Connections */}
        <div style={{ marginBottom: 14 }}>
          <div style={rpLabel}>3. Connections</div>
          {CONNECTIONS.map(({ name, status, color, dot }) => (
            <div key={name} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 0', borderBottom: '1px solid var(--border-0)',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: color + '22',
                border: `1px solid ${color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
              </div>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-1)' }}>{name}</span>
              <span style={{ fontSize: 9, color: dot ? 'var(--green)' : 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>{status}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: 'var(--border-0)', margin: '0 0 12px' }} />

        {/* AI Vibes preview */}
        <div>
          <div style={rpLabel}>AI Vibes</div>
          <div style={{
            background: 'var(--bg-3)', border: '1px solid var(--border-1)',
            borderRadius: 5, padding: '7px 8px',
            fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            {vibeText || 'warm acoustic and soft piano for a rainy day'}
          </div>
        </div>

      </div>
    </div>
  );
}
