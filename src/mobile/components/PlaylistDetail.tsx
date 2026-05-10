import React, { useState } from 'react';
import { ALBUMS, TRACKS } from '../data';
import type { Track } from '../data';
import { Icons } from '../icons';
import {
  MMArt, MMTabBar, MMHash, MMBranchPill, MMSheet, iconBtn,
} from './common';
import type { TabId } from './common';
import { MiniPlayer } from './Library';

function ActionTile({ Icon, label, badge, onPress }: {
  Icon: (p: { size?: number; stroke?: string }) => React.ReactElement;
  label: string; badge?: string; onPress?: () => void;
}) {
  return (
    <button onClick={onPress} style={{
      padding: '12px 6px', borderRadius: 12,
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      color: 'var(--text-0)', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      position: 'relative',
    }}>
      <Icon size={20} stroke="var(--text-0)"/>
      <span style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{label}</span>
      {badge && (
        <span style={{
          position: 'absolute', top: 8, right: 14,
          minWidth: 14, height: 14, borderRadius: 7, padding: '0 4px',
          background: 'var(--accent)', color: 'var(--bg-0)',
          fontSize: 9.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{badge}</span>
      )}
    </button>
  );
}

function TrackRow({ track, idx, playing = false, fav = false, added = false }: {
  track: Track; idx: string; playing?: boolean; fav?: boolean; added?: boolean;
}) {
  const album = ALBUMS[track.albumRef];
  const accent = album.accent;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
      background: playing ? `${accent}10` : 'transparent',
      borderLeft: playing ? `2px solid ${accent}` : '2px solid transparent',
    }}>
      <span style={{ width: 18, textAlign: 'right', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{idx}</span>
      <MMArt album={album} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</span>
          {fav && <Icons.heartFill size={11} stroke="var(--accent)"/>}
          {added && <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 4, background: 'oklch(0.32 0.10 50 / 0.4)' }}>NEW</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1 }}>{track.artist}</div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{track.length}</span>
      <Icons.moreV size={16} stroke="var(--text-3)"/>
    </div>
  );
}

// Swipe-revealed track row (shown partially open in design)
function SwipedTrackRow({ idx, track, added }: { idx: string; track: Track; added?: boolean }) {
  const album = ALBUMS[track.albumRef];
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'stretch' }}>
        <div style={{ width: 64, background: 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.queue size={16} stroke="var(--text-0)"/>
        </div>
        <div style={{ width: 64, background: '#7a2828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.trash size={16} stroke="#ffd6d6"/>
        </div>
      </div>
      <div style={{ transform: 'translateX(-128px)', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px' }}>
          <span style={{ width: 18, textAlign: 'right', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{idx}</span>
          <MMArt album={album} size={42} radius={7}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</span>
              {added && <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 4, background: 'oklch(0.32 0.10 50 / 0.4)' }}>NEW</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1 }}>{track.artist}</div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{track.length}</span>
        </div>
      </div>
    </div>
  );
}

// ── Branch picker sheet
function BranchPickerSheet({ onClose }: { onClose: () => void }) {
  const branches = [
    { name: 'main',            commit: '4fa9b0', author: 'you',      time: '2h', current: false, color: 'var(--accent)' },
    { name: 'party-edit',      commit: 'be0df2', author: 'you',      time: '6h', current: true,  color: 'var(--accent-light)' },
    { name: 'workout-version', commit: 'a2af36', author: 'device-2', time: '1d', current: false, color: 'var(--blue)' },
    { name: 'experiment',      commit: 'c91f33', author: 'you',      time: '3d', current: false, color: 'var(--text-2)' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}/>
      <MMSheet title="Branches" subtitle="Deep Workout · 4 branches" height="80%"
        accessory={
          <button style={{ padding: '7px 14px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icons.plus size={13}/> New
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {branches.map(b => (
            <div key={b.name} style={{
              padding: '11px 13px', borderRadius: 12,
              background: b.current ? 'oklch(0.32 0.12 50 / 0.35)' : 'var(--bg-3)',
              border: `0.5px solid ${b.current ? b.color : 'var(--border-1)'}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: `${b.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: b.color, fontSize: 14 }}>⎇</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace' }}>{b.name}</span>
                  {b.current && <span style={{ fontSize: 9.5, color: 'var(--bg-0)', background: b.color, padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>HEAD</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                  {b.commit} · {b.author} · {b.time} ago
                </div>
              </div>
              {b.current ? (
                <Icons.check size={18} stroke={b.color}/>
              ) : (
                <button style={iconBtn(28)}><Icons.moreV size={16} stroke="var(--text-2)"/></button>
              )}
            </div>
          ))}
          <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, border: '0.5px dashed var(--border-2)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', cursor: 'pointer' }}>
            <Icons.fork size={16}/>
            <div style={{ fontSize: 12.5, flex: 1 }}>Fork to a new playlist</div>
            <Icons.chevRight size={14}/>
          </div>
        </div>
      </MMSheet>
    </div>
  );
}

// ── Commit history
function HistoryView({ onBack }: { onBack: () => void }) {
  const commits = [
    { hash: 'be0df2', msg: 'Boost: Pumped Mario remix slot', author: 'you', time: '6h', branch: 'party-edit', diff: '+1' },
    { hash: 'b3f421', msg: 'Reorder: front-load high BPM', author: 'you', time: '8h', branch: 'party-edit', diff: '↕3' },
    { hash: '4fa9b0', msg: 'Merge branch dev → main', author: 'you', time: '1d', branch: 'main', diff: '+5', merge: true },
    { hash: 'a2af36', msg: 'Add Pulse + Climb', author: 'device-2', time: '2d', branch: 'workout-version', diff: '+2' },
    { hash: '9c2a31', msg: 'Initial workout selection', author: 'you', time: '5d', branch: 'main', diff: '+12' },
    { hash: '3ed5b0', msg: 'Fork from Cozy Melodies v2.0', author: 'you', time: '2w', branch: 'main', diff: 'fork' },
  ];

  const branchColor = (b: string) =>
    b === 'main' ? 'var(--accent)' :
    b === 'party-edit' ? 'var(--accent-light)' :
    b === 'workout-version' ? 'var(--blue)' : 'var(--text-2)';

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '12px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>Deep Workout</span>
          </button>
        </div>

        <div style={{ padding: '4px 22px 12px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>History</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>42 commits across 4 branches</div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 22px 12px', overflowX: 'auto' }} className="mm-scroll">
          {['All branches', '⎇ party-edit', '⎇ main', 'My commits'].map((l, i) => (
            <button key={l} style={{
              padding: '7px 14px', borderRadius: 99, flexShrink: 0,
              background: i === 0 ? 'var(--accent)' : 'var(--bg-2)',
              border: i === 0 ? '1px solid var(--accent)' : '0.5px solid var(--border-1)',
              color: i === 0 ? 'var(--bg-0)' : 'var(--text-1)',
              fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
            }}>{l}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 32px' }} className="mm-scroll">
          {commits.map((c, i) => {
            const bcol = branchColor(c.branch);
            const isLast = i === commits.length - 1;
            return (
              <div key={c.hash} style={{ display: 'flex', padding: '8px 22px', gap: 14 }}>
                <div style={{ width: 22, position: 'relative', flexShrink: 0 }}>
                  {!isLast && <div style={{ position: 'absolute', left: 10, top: 22, bottom: -8, width: 1.5, background: bcol, opacity: 0.5 }}/>}
                  <div style={{ position: 'absolute', left: 4, top: 6, width: 14, height: 14, borderRadius: c.merge ? 4 : 7, background: bcol, border: '2px solid var(--bg-1)', boxShadow: `0 0 0 1.5px ${bcol}, 0 0 10px ${bcol}55` }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 6, borderBottom: isLast ? 'none' : '0.5px solid var(--border-0)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MMHash color={bcol}>{c.hash}</MMHash>
                    <MMBranchPill branch={c.branch} color={bcol}/>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{c.time} ago</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-0)', marginTop: 4, lineHeight: 1.3 }}>{c.msg}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{c.author}</span>
                    <span style={{ fontSize: 11, color: c.diff.startsWith('+') ? 'var(--green)' : c.diff.startsWith('↕') ? 'var(--blue)' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{c.diff}</span>
                    {c.merge && <span style={{ fontSize: 10.5, color: 'var(--blue)', fontFamily: 'JetBrains Mono, monospace' }}>merge · 2 parents</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Merge sheet
function MergeSheet({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}/>
      <MMSheet title="Merge into party-edit" subtitle="3 commits ahead · clean working tree" height="78%">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="From branch">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <BranchChoice name="main" commit="4fa9b0" color="var(--accent)" selected/>
              <BranchChoice name="workout-version" commit="a2af36" color="var(--blue)"/>
            </div>
          </Field>

          <Field label="Strategy">
            <div style={{ display: 'flex', gap: 6, padding: 3, background: 'var(--bg-3)', borderRadius: 12 }}>
              <StratBtn label="Union" sub="all tracks from both" selected/>
              <StratBtn label="Intersection" sub="only common"/>
            </div>
          </Field>

          <Field label="Preview">
            <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <DiffStat n="+3" color="var(--green)" sub="added"/>
                <DiffStat n="−0" color="var(--text-2)" sub="removed"/>
                <DiffStat n="↕1" color="var(--blue)" sub="reordered"/>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>→ 14 total</span>
              </div>
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 99, background: 'var(--bg-3)', border: '0.5px solid var(--border-1)', color: 'var(--text-1)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
            <button style={{ flex: 2, padding: '12px', borderRadius: 99, background: 'var(--accent)', border: 'none', color: 'var(--bg-0)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icons.merge size={16}/> Merge
            </button>
          </div>
        </div>
      </MMSheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}
function BranchChoice({ name, commit, color, selected }: { name: string; commit: string; color: string; selected?: boolean }) {
  return (
    <button style={{ padding: '8px 12px', borderRadius: 12, background: selected ? `${color}1f` : 'var(--bg-3)', border: `0.5px solid ${selected ? color : 'var(--border-1)'}`, color: 'var(--text-0)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, fontSize: 12 }}>⎇</span>
      <span style={{ fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace' }}>{name}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{commit}</span>
    </button>
  );
}
function StratBtn({ label, sub, selected }: { label: string; sub: string; selected?: boolean }) {
  return (
    <button style={{ flex: 1, padding: '8px 6px', borderRadius: 9, background: selected ? 'var(--bg-5)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{sub}</span>
    </button>
  );
}
function DiffStat({ n, color, sub }: { n: string; color: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 18, color, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{n}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{sub}</span>
    </div>
  );
}

export function PlaylistDetail({ onBack, onTab, branch = 'party-edit' }: {
  onBack: () => void; onTab: (id: TabId) => void; branch?: string;
}) {
  const [sheet, setSheet] = useState<'branch' | 'merge' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const album = ALBUMS[4];

  if (showHistory) {
    return <HistoryView onBack={() => setShowHistory(false)}/>;
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '8px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>Playlists</span>
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={iconBtn(36)}><Icons.search size={18} stroke="var(--text-1)"/></button>
            <button style={iconBtn(36)}><Icons.more size={18} stroke="var(--text-1)"/></button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: '8px 22px 8px', alignItems: 'flex-end' }}>
          <MMArt album={album} size={112} radius={14} glow/>
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>Deep Workout</h1>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>22 tracks · 1h 38m</div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setSheet('branch')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                <span>⎇</span>{branch}<Icons.chevDown size={11} stroke="var(--bg-0)"/>
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: '4px 22px 0', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}>
          High-BPM remix branch — pumped versions of the chill picks. Forked from <span style={{ color: 'var(--accent)' }}>main</span> at <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>4fa9b0</span>.
        </div>

        <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 14px', borderRadius: 99, background: 'linear-gradient(135deg, var(--accent-light), var(--accent))', color: 'var(--bg-0)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 14, boxShadow: '0 8px 22px oklch(0.62 0.15 28 / 0.4)' }}>
            <Icons.play size={16}/> Play
          </button>
          <button style={iconBtn(44)}><Icons.shuffle size={20} stroke="var(--text-0)"/></button>
          <button style={iconBtn(44)}><Icons.download size={20} stroke="var(--text-1)"/></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '8px 16px 14px' }}>
          <ActionTile Icon={Icons.fork} label="Fork"/>
          <ActionTile Icon={Icons.merge} label="Merge" badge="2" onPress={() => setSheet('merge')}/>
          <ActionTile Icon={Icons.history} label="History" badge="•" onPress={() => setShowHistory(true)}/>
          <ActionTile Icon={Icons.gear} label="Edit"/>
        </div>

        <div style={{ margin: '4px 16px 12px', padding: '10px 12px', borderRadius: 12, background: 'oklch(0.32 0.10 50 / 0.35)', border: '1px solid oklch(0.55 0.13 60 / 0.45)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icons.alert size={16} stroke="var(--accent-light)"/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-0)', fontWeight: 500 }}>3 uncommitted changes</div>
            <div style={{ fontSize: 11, color: 'var(--text-1)', marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>+2 tracks · 1 reorder</div>
          </div>
          <button style={{ padding: '6px 12px', borderRadius: 99, background: 'var(--accent)', color: 'var(--bg-0)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Commit</button>
        </div>

        <div style={{ padding: '4px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Tracks</h3>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>22 · 1:38:24</span>
        </div>

        <SwipedTrackRow idx="01" track={{ ...TRACKS[3], title: 'Ember Walk (Pumped)' }} added/>
        <TrackRow idx="02" track={{ ...TRACKS[6], title: 'Midnight Protocol' }}/>
        <TrackRow idx="03" track={{ ...TRACKS[7], title: 'Ember Walk' }} fav playing/>
        <TrackRow idx="04" track={{ ...TRACKS[0], title: 'Iron Skies' }} added/>
        <TrackRow idx="05" track={{ ...TRACKS[2], title: 'Long Run' }}/>
        <TrackRow idx="06" track={{ ...TRACKS[4], title: 'Pulse' }} fav/>
        <TrackRow idx="07" track={{ ...TRACKS[1], title: 'Climb' }}/>

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer album={ALBUMS[4]}/>
      <MMTabBar active="playlists" onTab={onTab}/>

      {sheet === 'branch' && <BranchPickerSheet onClose={() => setSheet(null)}/>}
      {sheet === 'merge' && <MergeSheet onClose={() => setSheet(null)}/>}
    </div>
  );
}
