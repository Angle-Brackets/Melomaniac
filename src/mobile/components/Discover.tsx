import { ALBUMS } from '../data';
import { Icons } from '../icons';
import { MMArt, MMTabBar } from './common';
import type { TabId } from './common';

function Chip({ label, sel }: { label: string; sel?: boolean }) {
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 99,
      background: sel ? 'var(--accent)' : 'var(--bg-3)',
      color: sel ? 'var(--bg-0)' : 'var(--text-1)',
      border: sel ? 'none' : '0.5px solid var(--border-2)',
      fontSize: 11, fontWeight: 500,
    }}>{label}</span>
  );
}

function SectionHead({ label, trailing }: { label: string; trailing?: string }) {
  return (
    <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</h3>
      {trailing && <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{trailing}</span>}
    </div>
  );
}

export function Discover({ onTab }: { onTab: (id: TabId) => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -80, left: '50%', transform: 'translateX(-50%)', width: 440, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.62 0.15 28 / 0.22) 0%, transparent 70%)', filter: 'blur(20px)', pointerEvents: 'none' }}/>

      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '12px 22px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.sparkles size={22} stroke="var(--accent)"/>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Vibes</h1>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>
            Describe a mood, a moment, an album you wish existed. We'll stitch one from your library.
          </div>
        </div>

        <div style={{ margin: '12px 16px 14px', padding: '14px', borderRadius: 16, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)' }}>
          <div style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Prompt</div>
          <div style={{ marginTop: 8, fontSize: 15, color: 'var(--text-0)', lineHeight: 1.45, minHeight: 70 }}>
            sunday morning, rain on the kitchen window, slow coffee, no lyrics
            <span style={{ display: 'inline-block', width: 1.5, height: 16, background: 'var(--accent)', marginLeft: 2, verticalAlign: 'middle' }}/>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="warm" sel/>
            <Chip label="instrumental" sel/>
            <Chip label="65–80 BPM" sel/>
            <Chip label="+ piano"/>
            <Chip label="+ ambient"/>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button style={{ flex: 1, padding: '11px', borderRadius: 99, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', color: 'var(--bg-0)', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 8px 22px oklch(0.62 0.15 28 / 0.4)' }}>
              <Icons.sparkles size={16}/> Generate
            </button>
            <button style={{ padding: '11px 14px', borderRadius: 99, background: 'var(--bg-3)', color: 'var(--text-1)', border: '0.5px solid var(--border-1)', cursor: 'pointer', fontSize: 14 }}>Try again</button>
          </div>
        </div>

        <SectionHead label="Draft playlist" trailing="48m"/>
        <div style={{ margin: '4px 16px 12px', padding: '12px', borderRadius: 14, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
              <MMArt album={ALBUMS[1]} size={64} radius={9} style={{ position: 'absolute', left: 6, top: 4, transform: 'rotate(-6deg)', opacity: 0.8 }}/>
              <MMArt album={ALBUMS[5]} size={64} radius={9} style={{ position: 'absolute', left: 0, top: 0 }} glow/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600 }}>Slow Sunday</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 }}>12 tracks · pulled from 4 albums</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button style={{ padding: '4px 10px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Save as playlist</button>
                <button style={{ padding: '4px 10px', borderRadius: 99, background: 'var(--bg-3)', color: 'var(--text-1)', border: '0.5px solid var(--border-1)', fontSize: 11, cursor: 'pointer' }}>Preview</button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, borderTop: '0.5px solid var(--border-1)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { t: 'Coffee Shop Ambience', a: 'Anna Bair', len: '2:18', i: 1 },
              { t: 'Rain on Glass', a: 'Anna Bair', len: '3:02', i: 0 },
              { t: 'Forest Dawn', a: 'Lorun', len: '4:14', i: 5 },
              { t: 'Sunset Keys', a: 'Lorun', len: '2:44', i: 2 },
            ].map((r, k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <span style={{ width: 14, fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{k + 1}</span>
                <MMArt album={ALBUMS[r.i]} size={22} radius={4}/>
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.t}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{r.len}</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 4 }}>+ 8 more</div>
          </div>
        </div>

        <SectionHead label="Try a prompt"/>
        <div style={{ padding: '4px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            'long drive, headlights on, slightly melancholic',
            'finishing a novel at 2am',
            'walking through a city at first snow',
            'sunset on a slow river',
          ].map((p, i) => (
            <div key={i} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <span style={{ color: 'var(--accent)', fontSize: 14 }}>"</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.35 }}>{p}</span>
              <Icons.chevRight size={14} stroke="var(--text-3)"/>
            </div>
          ))}
        </div>
      </div>

      <MMTabBar active="discover" onTab={onTab}/>
    </div>
  );
}
