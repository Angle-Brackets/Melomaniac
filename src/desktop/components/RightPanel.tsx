import { useState } from 'react';
import { CHART_BARS, CHART_LINE } from '../data';
import { FiChevronRight } from 'react-icons/fi';

// ── Inline mini charts ────────────────────────────────────────────────────────
function MiniBarChart({ data, color = 'var(--accent-dim)' }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-0.5 h-8 mt-1">
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${(v / max) * 100}%`,
          background: color, borderRadius: '1px 1px 0 0',
          minHeight: 2, opacity: 0.7 + (v / max) * 0.3,
        }} />
      ))}
    </div>
  );
}

function MiniLineChart({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const W = 100, H = 32;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - ((v - min) / range) * (H - 4) - 2,
  ]);
  const d    = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const fill = `${d} L ${pts[pts.length - 1][0]} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8 mt-1 block">
      <defs>
        <linearGradient id="lgf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lgf)"/>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Connections ───────────────────────────────────────────────────────────────
const CONNECTIONS = [
  { name: 'Spotify Premium', status: 'Connected',  color: '#1db954', dot: true },
  { name: 'Last.fm',         status: 'Connect…',   color: '#d51007', dot: false },
  { name: 'Upstream Remote', status: 'Up-to-Date', color: 'var(--green)', dot: true },
];

// ── Section label ─────────────────────────────────────────────────────────────
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[9px] font-bold tracking-[0.12em] text-mm-t2 uppercase mb-1.5">{children}</p>
);

interface RightPanelProps {
  vibeText: string;
  onVibeChange: (v: string) => void;
  onCollapse: () => void;
}

export default function RightPanel({ vibeText, onVibeChange, onCollapse }: RightPanelProps): JSX.Element {
  const [generating, setGenerating] = useState(false);
  const [aiResult,   setAiResult]   = useState<string | null>(null);

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
      width: '100%', background: 'var(--bg-1)',
      borderLeft: '1px solid var(--border-0)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-mm-b0 shrink-0">
        <span className="text-[9px] font-bold tracking-[0.12em] text-mm-t2 uppercase">
          Melomaniac AI &amp; Metrics
        </span>
        <button className="btn btn-ghost btn-xs btn-square text-mm-t2" onClick={onCollapse}>
          <FiChevronRight size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-3 styled-scroll">

        {/* 1. AI vibe generator */}
        <section>
          <SectionLabel>1. Describe your vibe…</SectionLabel>
          <textarea
            value={vibeText}
            onChange={e => onVibeChange(e.target.value)}
            placeholder="chill ambient music for focus"
            className="textarea textarea-bordered textarea-xs w-full bg-mm-3 text-mm-t1 font-['Outfit'] resize-none min-h-[48px]"
            onFocus={e => (e.target.style.borderColor = 'var(--accent-dim)')}
            onBlur={e => (e.target.style.borderColor = '')}
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={`btn btn-ghost btn-xs btn-block mt-1 ${generating ? '' : 'text-primary'}`}
          >
            {generating ? 'Generating…' : 'Generate Playlist'}
          </button>

          {aiResult && (
            <pre className="mt-2 p-2 bg-mm-3 rounded border border-mm-b1 text-[10px] text-mm-t1 leading-relaxed font-mono whitespace-pre-wrap">
              {aiResult}
            </pre>
          )}

          {/* Local AI indicator */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-mm-green"
              style={{ boxShadow: '0 0 5px var(--green)' }} />
            <span className="font-mono text-[10px] text-mm-t2">
              Gemma 4 (Local AI) <span className="text-mm-green">Active</span>
            </span>
          </div>
        </section>

        <div className="h-px bg-mm-b0" />

        {/* 2. Stats */}
        <section>
          <SectionLabel>2. Your Stats</SectionLabel>
          <p className="text-[10px] text-mm-t2 mb-1.5">Listen time · most played artist · top playlist</p>
          <div className="flex gap-1.5">
            <div className="flex-1 bg-mm-3 border border-mm-b0 rounded p-1.5">
              <p className="text-[9px] text-mm-t2">Play time</p>
              <MiniLineChart data={CHART_LINE} color="var(--accent)" />
            </div>
            <div className="flex-1 bg-mm-3 border border-mm-b0 rounded p-1.5">
              <p className="text-[9px] text-mm-t2">Skips</p>
              <MiniBarChart data={CHART_BARS} color="var(--accent-dim)" />
            </div>
          </div>
          <div className="flex gap-1 mt-1.5">
            {(['4h 22m', 'Anna Bair', 'Study Beats'] as const).map((v, i) => {
              const labels = ['This week', 'Top artist', 'Top playlist'];
              return (
                <div key={v} className="flex-1 bg-mm-3 border border-mm-b0 rounded px-1.5 py-1.5">
                  <p className="text-[10px] font-semibold text-mm-t0 truncate">{v}</p>
                  <p className="text-[9px] text-mm-t2 mt-px truncate">{labels[i]}</p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="h-px bg-mm-b0" />

        {/* 3. Service connections */}
        <section>
          <SectionLabel>3. Connections</SectionLabel>
          {CONNECTIONS.map(({ name, status, color, dot }) => (
            <div key={name} className="flex items-center gap-1.5 py-1.5 border-b border-mm-b0">
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: color + '22', border: `1px solid ${color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
              </div>
              <span className="flex-1 text-[11px] text-mm-t1">{name}</span>
              <span className="font-mono text-[9px]" style={{ color: dot ? 'var(--green)' : 'var(--text-2)' }}>{status}</span>
            </div>
          ))}
        </section>

        <div className="h-px bg-mm-b0" />

        {/* AI Vibes preview */}
        <section>
          <SectionLabel>AI Vibes</SectionLabel>
          <p className="bg-mm-3 border border-mm-b1 rounded p-2 text-[11px] text-mm-t1 leading-relaxed italic">
            {vibeText || 'warm acoustic and soft piano for a rainy day'}
          </p>
        </section>

      </div>
    </div>
  );
}
