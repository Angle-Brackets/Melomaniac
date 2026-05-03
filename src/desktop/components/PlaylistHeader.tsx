import { ALBUMS } from '../data';
import type { Playlist } from '../data';

interface PlaylistHeaderProps {
  playlist: Playlist;
  onGitAction: (action: string) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onNewBranch: () => void;
}

const GearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="6.5" cy="6.5" r="1.8"/>
    <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.4 2.4l.85.85M9.75 9.75l.85.85M2.4 10.6l.85-.85M9.75 3.25l.85-.85"/>
  </svg>
);

const PinIcon = ({ filled }: { filled: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 11 11" fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "currentColor"} strokeWidth="1.3">
    <path d="M6.5 1l3.5 3.5-1.5 1.5L7 5.5 5 9l-3-3 3.5-2L4.5 3z" strokeLinejoin="round"/>
    <path d="M1 10l2.5-2.5" strokeLinecap="round"/>
  </svg>
);

const TABS = ['Tracks', 'History', 'Settings'];

export default function PlaylistHeader({ playlist, onGitAction, activeTab, onTabChange, isPinned, onTogglePin, onNewBranch }: PlaylistHeaderProps) {
  const art = ALBUMS[1];

  return (
    <div style={{ borderBottom: '1px solid var(--border-0)', background: 'var(--bg-1)', flexShrink: 0 }}>
      <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 7, background: art.gradient, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)' }}>{playlist.name}</span>
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-2)' }}>v{playlist.version}</span>
            <span style={{ fontSize: 13 }}>☕</span>
            <button onClick={onTogglePin} title={isPinned ? 'Unpin playlist' : 'Pin playlist'} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
              color: isPinned ? 'var(--accent)' : 'var(--text-3)', transition: 'color 0.15s',
              display: 'flex', alignItems: 'center',
            }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-light)')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = isPinned ? 'var(--accent)' : 'var(--text-3)')}
            >
              <PinIcon filled={isPinned} />
            </button>
            <button onClick={() => onTabChange('Settings')} title="Playlist settings" style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
              color: activeTab === 'Settings' ? 'var(--accent-light)' : 'var(--text-3)', transition: 'color 0.15s',
              display: 'flex', alignItems: 'center',
            }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = activeTab === 'Settings' ? 'var(--accent-light)' : 'var(--text-3)')}
            >
              <GearIcon />
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
            Remote: upstream/{playlist.name.toLowerCase().replace(/ /g, '-')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="git-btn" onClick={() => onGitAction('shuffle')}>▶ Shuffle</button>
          <button className="git-btn" onClick={() => onGitAction('commit')}>Commit</button>
          <button className="git-btn" onClick={onNewBranch} title="Create a new branch from any commit">⎇ Branch</button>
          <button className="git-btn primary" onClick={() => onGitAction('push')}>↑ Push</button>
          <button className="git-btn primary" onClick={() => onGitAction('pull')}>↓ Pull</button>
        </div>
      </div>

      <div style={{ display: 'flex', padding: '0 14px', gap: 0 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => onTabChange(tab)} style={{
            padding: '5px 14px', fontSize: 11, fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? 'var(--accent-light)' : 'var(--text-2)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
            transition: 'all 0.15s', fontFamily: "'Outfit', sans-serif",
            marginBottom: -1,
          }}
            onMouseEnter={e => { if (activeTab !== tab) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { if (activeTab !== tab) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; }}
          >{tab}</button>
        ))}
      </div>
    </div>
  );
}
