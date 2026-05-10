import { ALBUMS, TRACKS } from '../data';
import type { Track } from '../data';
import { Icons } from '../icons';
import { MMArt, MMTabBar, MMHash, MMBranchPill, iconBtn } from './common';
import type { TabId } from './common';

function MMSearchBar({ placeholder = 'Search tracks' }: { placeholder?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      borderRadius: 14, color: 'var(--text-2)',
    }}>
      <Icons.search size={16} stroke="var(--text-2)"/>
      <span style={{ fontSize: 15, color: 'var(--text-2)', flex: 1 }}>{placeholder}</span>
      <Icons.filter size={16} stroke="var(--text-2)"/>
    </div>
  );
}

function FilterPill({ label, active, count }: { label: string; active?: boolean; count?: number }) {
  return (
    <button style={{
      padding: '7px 14px', borderRadius: 99,
      background: active ? 'var(--accent)' : 'var(--bg-2)',
      border: active ? '1px solid var(--accent)' : '0.5px solid var(--border-1)',
      color: active ? 'var(--bg-0)' : 'var(--text-1)',
      fontSize: 12.5, fontWeight: 500, letterSpacing: 0.02,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {label}
      {count != null && <span style={{ fontSize: 10.5, opacity: 0.7, fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>}
    </button>
  );
}

function TrackRow({ track, idx, playing = false, fav = false }: {
  track: Track; idx: string; playing?: boolean; fav?: boolean;
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
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.artist} · {track.album}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{track.length}</span>
      <Icons.moreV size={16} stroke="var(--text-3)"/>
    </div>
  );
}

export function MiniPlayer({ playing = true, album = ALBUMS[1] }: { playing?: boolean; album?: typeof ALBUMS[0] }) {
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 90, zIndex: 25,
      height: 62, borderRadius: 16, padding: '8px 10px',
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: 'var(--bg-3)' }}>
        <div style={{ height: '100%', width: '38%', background: `linear-gradient(90deg, ${album.accent}, var(--accent-light))` }}/>
      </div>
      <MMArt album={album} size={44} radius={9}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.artist}</div>
      </div>
      <button style={iconBtn(38)}>
        {playing ? <Icons.pause size={18} stroke="var(--text-0)"/> : <Icons.play size={18} stroke="var(--text-0)"/>}
      </button>
      <button style={iconBtn(38)}><Icons.next size={20} stroke="var(--text-1)"/></button>
    </div>
  );
}

function SectionHead({ label, trailing, collapsible }: { label: string; trailing?: string; collapsible?: boolean }) {
  return (
    <div style={{ padding: '14px 22px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {collapsible && <Icons.chevDown size={12} stroke="var(--text-2)"/>}
        <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</h3>
      </div>
      {trailing && <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{trailing}</span>}
    </div>
  );
}

function PlaylistCard({ name, desc, branch, commit, albumIndex, branches, pinned, pull, uncommitted, indent, onPress }: {
  name: string; desc: string; branch: string; commit: string;
  albumIndex: number; branches: number; pinned?: boolean; pull?: boolean;
  uncommitted?: boolean; indent?: boolean; onPress?: () => void;
}) {
  const album = ALBUMS[albumIndex];
  return (
    <div onClick={onPress} style={{
      margin: `4px ${indent ? '36px' : '16px'} 4px ${indent ? '36px' : '16px'}`,
      padding: '10px 12px',
      background: 'var(--bg-2)', border: '0.5px solid var(--border-1)',
      borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
      cursor: 'pointer',
    }}>
      <MMArt album={album} size={54} radius={9}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {pinned && <span style={{ color: 'var(--accent)', fontSize: 10 }}>●</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <MMBranchPill branch={branch}/>
          <MMHash>{commit}</MMHash>
          {branches > 1 && <MMHash color="var(--text-3)">+{branches - 1}</MMHash>}
          {uncommitted && <span style={{ fontSize: 10.5, color: 'var(--accent-light)', fontFamily: 'JetBrains Mono, monospace' }}>● changes</span>}
          {pull && <span style={{ fontSize: 10.5, color: 'var(--blue)', fontFamily: 'JetBrains Mono, monospace' }}>↓ pull</span>}
        </div>
      </div>
      <Icons.chevRight size={14} stroke="var(--text-3)"/>
    </div>
  );
}

export function Library({ onTab }: { onTab: (id: TabId) => void; onPlaylistDetail?: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.5 }}>Library</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={iconBtn(32)}><Icons.download size={18} stroke="var(--text-1)"/></button>
            <button style={iconBtn(32)}><Icons.more size={18} stroke="var(--text-1)"/></button>
          </div>
        </div>
        <div style={{ padding: '4px 22px 0', fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
          247 tracks · 12.4 GB · synced 2m ago
        </div>

        <div style={{ padding: '14px 22px 8px' }}>
          <MMSearchBar/>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '8px 22px 14px', overflowX: 'auto' }} className="mm-scroll">
          <FilterPill label="All" active count={247}/>
          <FilterPill label="Favorites" count={38}/>
          <FilterPill label="Recently Added"/>
          <FilterPill label="Downloads" count={12}/>
          <FilterPill label="By Artist"/>
        </div>

        <div style={{ padding: '4px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Recently added</h3>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>this week</span>
        </div>

        <div>
          <TrackRow idx="01" track={TRACKS[3]} playing fav/>
          <TrackRow idx="02" track={TRACKS[2]}/>
          <TrackRow idx="03" track={TRACKS[1]} fav/>
          <TrackRow idx="04" track={TRACKS[0]}/>
          <TrackRow idx="05" track={TRACKS[4]}/>
          <TrackRow idx="06" track={TRACKS[6]} fav/>
          <TrackRow idx="07" track={TRACKS[5]}/>
          <TrackRow idx="08" track={TRACKS[7]}/>

          <div style={{ padding: '18px 22px 6px' }}>
            <h3 style={{ fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Last month</h3>
          </div>
          <TrackRow idx="09" track={{ ...TRACKS[2], title: 'Slow Tide' }}/>
          <TrackRow idx="10" track={{ ...TRACKS[5], title: 'Window Seat' }} fav/>
          <TrackRow idx="11" track={{ ...TRACKS[1], title: 'Far Hum' }}/>
        </div>

        <div style={{ height: 12 }}/>
      </div>

      <MiniPlayer/>
      <MMTabBar active="library" onTab={onTab}/>
    </div>
  );
}

export function PlaylistsList({ onTab, onPlaylistDetail }: { onTab: (id: TabId) => void; onPlaylistDetail: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: '16px 0 86px', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '14px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.5 }}>Playlists</h1>
          <button style={iconBtn(36)}><Icons.plus size={20} stroke="var(--accent)"/></button>
        </div>
        <div style={{ padding: '4px 22px 12px', fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
          7 playlists · 14 branches
        </div>

        <div style={{ padding: '4px 22px 8px' }}>
          <MMSearchBar placeholder="Search playlists"/>
        </div>

        <SectionHead label="Pinned" trailing="1"/>
        <PlaylistCard
          name="Study Beats" desc="Lo-fi for deep focus · 38 tracks"
          branch="main" commit="4fa9b0" albumIndex={2} branches={3} pinned
          onPress={onPlaylistDetail}
        />

        <SectionHead label="All playlists" trailing="6"/>
        <PlaylistCard name="Cozy Melodies" desc="Rainy day acoustic · 24 tracks" branch="main" commit="3ed5b0" albumIndex={0} branches={1} onPress={onPlaylistDetail}/>
        <PlaylistCard name="Lo-Fi Lounge" desc="Forked from upstream · 51 tracks" branch="main" commit="3ed5b0" albumIndex={3} branches={2} pull onPress={onPlaylistDetail}/>
        <PlaylistCard name="Deep Workout" desc="High BPM · 22 tracks" branch="party-edit" commit="be0df2" albumIndex={4} branches={4} uncommitted onPress={onPlaylistDetail}/>

        <SectionHead label="Folder: Gaming sessions" collapsible trailing="2"/>
        <PlaylistCard name="Chill Games" desc="Stardew, Animal Crossing · 18 tracks" branch="main" commit="9c2a31" albumIndex={5} branches={1} indent onPress={onPlaylistDetail}/>
        <PlaylistCard name="Fast Pace" desc="Sonic-style energy · 27 tracks" branch="main" commit="9c2a31" albumIndex={6} branches={2} indent onPress={onPlaylistDetail}/>

        <div style={{ height: 18 }}/>
      </div>

      <MiniPlayer/>
      <MMTabBar active="playlists" onTab={onTab}/>
    </div>
  );
}
