import { ALBUMS } from '../data';
import type { Playlist } from '../data';
import { IcoPin } from '../icons';
import { FiSettings as GearIcon } from 'react-icons/fi';

interface PlaylistHeaderProps {
  playlist:     Playlist;
  onGitAction:  (action: string) => void;
  activeTab:    string;
  onTabChange:  (tab: string) => void;
  isPinned:     boolean;
  onTogglePin:  () => void;
  onNewBranch:  () => void;
}

const TABS = ['Tracks', 'History', 'Settings'] as const;

export default function PlaylistHeader({
  playlist, onGitAction, activeTab, onTabChange, isPinned, onTogglePin, onNewBranch,
}: PlaylistHeaderProps) {
  const art = ALBUMS[1];

  return (
    <div className="border-b border-mm-b0 bg-mm-1 shrink-0">
      {/* Playlist info + action row */}
      <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-2">
        {/* Album art thumbnail */}
        <div
          className="w-11 h-11 rounded-lg shrink-0 shadow-md"
          style={{ background: art.gradient }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-mm-t0">{playlist.name}</span>
            <span className="text-sm font-normal text-mm-t2">v{playlist.version}</span>
            <span className="text-[13px]">☕</span>

            <button
              onClick={onTogglePin}
              title={isPinned ? 'Unpin playlist' : 'Pin playlist'}
              className={`btn btn-ghost btn-xs btn-square ${isPinned ? 'text-primary' : 'text-mm-t3'}`}
            >
              <IcoPin filled={isPinned} />
            </button>

            <button
              onClick={() => onTabChange('Settings')}
              title="Playlist settings"
              className={`btn btn-ghost btn-xs btn-square ${activeTab === 'Settings' ? 'text-primary' : 'text-mm-t3'}`}
            >
              <GearIcon size={13} />
            </button>
          </div>
          <p className="font-mono text-[10px] text-mm-t2 mt-0.5">
            Remote: upstream/{playlist.name.toLowerCase().replace(/ /g, '-')}
          </p>
        </div>

        {/* Git action buttons */}
        <div className="flex gap-1.5 shrink-0">
          <button className="btn btn-ghost btn-xs" onClick={() => onGitAction('shuffle')}>▶ Shuffle</button>
          <button className="btn btn-ghost btn-xs" onClick={() => onGitAction('commit')}>Commit</button>
          <button className="btn btn-ghost btn-xs" onClick={onNewBranch} title="Branch from any commit">⎇ Branch</button>
          <button className="btn btn-primary btn-xs" onClick={() => onGitAction('push')}>↑ Push</button>
          <button className="btn btn-primary btn-xs" onClick={() => onGitAction('pull')}>↓ Pull</button>
        </div>
      </div>

      {/* DaisyUI tabs */}
      <div className="tabs tabs-bordered px-2 -mb-px">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`tab text-[11px] ${activeTab === tab ? 'tab-active font-semibold' : 'text-mm-t2'}`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
