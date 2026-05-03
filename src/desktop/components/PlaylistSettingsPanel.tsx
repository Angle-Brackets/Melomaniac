import { useState } from 'react';
import type { Playlist } from '../data';

export default function PlaylistSettingsPanel({ playlist }: { playlist: Playlist }) {
  const [upstream, setUpstream] = useState(
    `github.com/you/${(playlist?.name ?? '').toLowerCase().replace(/ /g, '-')}`
  );

  return (
    <div className="flex-1 px-6 py-[18px] overflow-y-auto styled-scroll">
      <div style={{ maxWidth: 500 }}>
        <div className="text-[10px] font-bold tracking-widest text-mm-t2 uppercase mb-2.5">Playlist Settings</div>

        {([
          ['Name', playlist?.name],
          ['Version', `v${playlist?.version}`],
          ['Branch', playlist?.branch ?? 'main'],
          ['Last commit', playlist?.commit ?? '—'],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2 border-b border-mm-b0">
            <span className="text-[12px] text-mm-t2">{k}</span>
            <span className={`text-[12px] text-mm-t0 ${k === 'Last commit' ? 'font-mono' : ''}`}>{v}</span>
          </div>
        ))}

        <div className="py-2.5 border-b border-mm-b0">
          <div className="text-[12px] text-mm-t2 mb-1.5">Upstream remote URL</div>
          <input
            value={upstream}
            onChange={e => setUpstream(e.target.value)}
            className="input input-sm w-full font-mono text-[11px] bg-mm-3 text-mm-t0"
          />
        </div>

        <div className="flex gap-2 mt-3.5">
          <button className="btn btn-ghost btn-sm text-mm-t1">Fork Playlist</button>
          <button className="btn btn-ghost btn-sm text-error">Delete Playlist</button>
          <button className="btn btn-sm border border-mm-accent-dim bg-mm-5 text-mm-accent-lit">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
