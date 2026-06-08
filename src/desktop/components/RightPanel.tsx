import { useState } from 'react';
import { FiChevronRight } from 'react-icons/fi';

// ── Connections ───────────────────────────────────────────────────────────────
const CONNECTIONS = [
  { name: 'Spotify',         status: 'Not connected', color: '#1db954', dot: false },
  { name: 'Last.fm',         status: 'Not connected', color: '#d51007', dot: false },
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
      await new Promise(res => setTimeout(res, 600));
      setAiResult('AI playlist generation coming soon.');
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

        </section>

        <div className="h-px bg-mm-b0" />

        {/* 2. Stats */}
        <section>
          <SectionLabel>2. Your Stats</SectionLabel>
          <p className="text-[10px] text-mm-t2">Coming soon.</p>
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
