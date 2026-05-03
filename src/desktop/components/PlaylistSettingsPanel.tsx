import { useState } from 'react';
import type { Playlist } from '../data';

export default function PlaylistSettingsPanel({ playlist }: { playlist: Playlist }) {
  const [upstream, setUpstream] = useState(
    `github.com/you/${(playlist?.name ?? '').toLowerCase().replace(/ /g, '-')}`
  );

  return (
    <div style={{ flex: 1, padding: '18px 24px', overflowY: 'auto' }} className="styled-scroll">
      <div style={{ maxWidth: 500 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 10 }}>Playlist Settings</div>

        {([
          ['Name', playlist?.name],
          ['Version', `v${playlist?.version}`],
          ['Branch', playlist?.branch ?? 'main'],
          ['Last commit', playlist?.commit ?? '—'],
        ] as const).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-0)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{k}</span>
            <span style={{ fontSize: 12, color: 'var(--text-0)', fontFamily: k === 'Last commit' ? "'JetBrains Mono', monospace" : 'inherit' }}>{v}</span>
          </div>
        ))}

        <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-0)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>Upstream remote URL</div>
          <input value={upstream} onChange={e => setUpstream(e.target.value)} style={{
            width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border-1)',
            borderRadius: 5, padding: '6px 9px', fontSize: 11, color: 'var(--text-0)',
            fontFamily: "'JetBrains Mono', monospace", outline: 'none',
          }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent-dim)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-1)')}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {(['Fork Playlist', 'Delete Playlist', 'Save Changes'] as const).map(label => (
            <button key={label} style={{
              padding: '6px 14px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${label === 'Save Changes' ? 'var(--accent-dim)' : 'var(--border-1)'}`,
              background: label === 'Save Changes' ? 'var(--bg-5)' : 'transparent',
              color: label === 'Save Changes' ? 'var(--accent-light)' : label === 'Delete Playlist' ? '#e06060' : 'var(--text-1)',
              fontFamily: "'Outfit', sans-serif",
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
