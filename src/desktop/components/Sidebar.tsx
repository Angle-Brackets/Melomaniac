import { useState } from 'react';
import type { Playlist } from '../data';
import {
  IcoMenu, IcoLibrary, IcoMusicLib, IcoHistory, IcoGit, IcoSync,
  IcoEditor, IcoDownload, IcoMetrics, IcoSettings, IcoPin, IcoChevron,
} from '../icons';

// ── Rail icon with tooltip ────────────────────────────────────────────────────
interface RailIconProps {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

function RailIcon({ icon, active = false, onClick, title }: RailIconProps) {
  const [hovered, setHovered] = useState(false);
  const [label, sub] = (title ?? '').split(' — ');
  return (
    <div
      className="rail-icon-wrap"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, cursor: 'pointer',
        color: active ? 'var(--accent-light)' : hovered ? 'var(--text-1)' : 'var(--text-2)',
        background: active ? 'var(--bg-5)' : hovered ? 'var(--bg-3)' : 'transparent',
        transition: 'all 0.14s',
      }}>
        {icon}
      </div>
      {title && (
        <div className="rail-tooltip">
          <span style={{ color: 'var(--text-0)', fontWeight: 600 }}>{label}</span>
          {sub && <span style={{ color: 'var(--text-2)', fontSize: 10, display: 'block', marginTop: 1 }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ── Pin/unpin button ──────────────────────────────────────────────────────────
function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={e => { e.stopPropagation(); onToggle(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={pinned ? 'Unpin' : 'Pin to top'}
      style={{
        opacity: pinned ? 1 : hov ? 0.8 : 0,
        transition: 'opacity 0.15s',
        cursor: 'pointer', padding: '1px', flexShrink: 0,
        color: pinned ? 'var(--accent)' : 'var(--text-2)',
      }}
    >
      <IcoPin filled={pinned} />
    </div>
  );
}

// ── Add-to-folder popup ───────────────────────────────────────────────────────
interface FolderItem { id: number; name: string; }
interface AddToFolderPopupProps {
  item: Playlist;
  folders: FolderItem[];
  onClose: () => void;
  onAddToFolder: (itemId: string, folderId: number) => void;
  onCreateFolder: (name: string, itemId: string) => void;
}

export function AddToFolderPopup({ item, folders, onClose, onAddToFolder, onCreateFolder }: AddToFolderPopupProps) {
  const [newName,  setNewName]  = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <dialog className="modal modal-open" style={{ zIndex: 300 }}>
      <div className="modal-box bg-mm-2 border border-mm-b2 max-w-xs p-0 overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-mm-b0 bg-mm-0">
          <p className="text-xs font-bold text-mm-t0">Add "{item.name}" to folder</p>
        </div>
        <div className="py-2">
          {folders.length > 0 && (
            <>
              <p className="px-3.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-mm-t2">Existing folders</p>
              {folders.map(f => (
                <button key={f.id}
                  onClick={() => { onAddToFolder(item.id, f.id); onClose(); }}
                  className="w-full flex items-center gap-1.5 px-3.5 py-1.5 text-xs text-mm-t1 hover:bg-mm-4 transition-colors text-left"
                >
                  📁 {f.name}
                </button>
              ))}
              <div className="h-px bg-mm-b0 mx-2.5 my-1" />
            </>
          )}
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-1.5 px-3.5 py-1.5 text-xs text-primary hover:bg-mm-4 transition-colors"
            >
              <span className="font-bold text-sm">+</span> Create new folder…
            </button>
          ) : (
            <div className="flex gap-1.5 px-3.5 py-1.5">
              <input
                autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Folder name"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) { onCreateFolder(newName.trim(), item.id); onClose(); }
                  if (e.key === 'Escape') setCreating(false);
                }}
                className="input input-xs flex-1 bg-mm-3 text-mm-t0 font-['Outfit']"
              />
              <button
                onClick={() => { if (newName.trim()) { onCreateFolder(newName.trim(), item.id); onClose(); } }}
                className="btn btn-primary btn-xs"
              >Create</button>
            </div>
          )}
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

// ── Playlist row ──────────────────────────────────────────────────────────────
interface PlaylistRowProps {
  item: Playlist; activeId: string | null; depth: number;
  onSelect: (id: string) => void; defaultOpen?: boolean;
  pinnedIds: Set<string>; onTogglePin: (id: string) => void;
  onAddToFolderClick: (item: Playlist) => void; synced: boolean;
}

function PlaylistRow({ item, activeId, depth, onSelect, defaultOpen, pinnedIds, onTogglePin, onAddToFolderClick, synced }: PlaylistRowProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [hov,  setHov]  = useState(false);
  const isActive    = item.id === activeId;
  const isPinned    = pinnedIds.has(item.id);
  const hasChildren = !!item.children?.length;

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <div
        onClick={() => hasChildren ? setOpen(!open) : onSelect(item.id)}
        style={{
          padding: `5px 10px 5px ${10 + depth * 12}px`,
          cursor: 'pointer',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          background: isActive ? 'var(--bg-5)' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-3)'; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {hasChildren && (
              <span className="text-mm-t2 shrink-0">
                <IcoChevron size={9} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
              </span>
            )}
            {isPinned && <span className="shrink-0 opacity-70 text-primary"><IcoPin filled size={11} /></span>}
            <span style={{
              fontSize: 12, fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--accent-light)' : 'var(--text-0)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {item.name}
              {item.version && <span style={{ color: 'var(--text-2)', fontWeight: 400 }}> v{item.version}</span>}
            </span>
          </div>
          {item.commit && (
            <div style={{
              fontSize: 10, color: 'var(--text-2)',
              fontFamily: "'JetBrains Mono', monospace", marginTop: 1,
              paddingLeft: hasChildren || isPinned ? 13 : 0,
            }}>
              {item.commit} · {item.synced}
            </div>
          )}
        </div>

        <div className="flex items-center gap-[3px] shrink-0 pt-px">
          {synced && !item.pull && item.commit && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
              stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <title>Up to date</title><path d="M2 5l2.2 2.2L8 3"/>
            </svg>
          )}
          {item.pull && (
            <span className="font-mono text-[9px] bg-mm-accent-dim text-mm-accent-lit px-1 py-px rounded-sm">pull?</span>
          )}
          {(hov || isPinned) && <PinButton pinned={isPinned} onToggle={() => onTogglePin(item.id)} />}
          {hov && (
            <span
              onClick={e => { e.stopPropagation(); onAddToFolderClick(item); }}
              className="text-mm-t2 opacity-60 cursor-pointer flex items-center"
              title="Add to folder"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <rect x="4.25" y="0" width="1.5" height="10" rx="0.75"/>
                <rect x="0" y="4.25" width="10" height="1.5" rx="0.75"/>
              </svg>
            </span>
          )}
        </div>
      </div>

      {hasChildren && open && (
        <div>
          {item.children!.map(child => (
            <PlaylistRow key={child.id} item={child} activeId={activeId} depth={depth + 1}
              onSelect={onSelect} pinnedIds={pinnedIds} onTogglePin={onTogglePin}
              onAddToFolderClick={onAddToFolderClick} synced={!child.pull && !!child.commit} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Collapsible section header ────────────────────────────────────────────────
function CollapsibleSection({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-mm-b0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold tracking-[0.08em] text-mm-t2 uppercase hover:text-mm-t1 transition-colors"
      >
        <span>{label}</span>
        <IcoChevron size={9} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && children}
    </div>
  );
}

// ── LibrarySidebar ────────────────────────────────────────────────────────────
interface LibrarySidebarProps {
  playlists: Playlist[]; activePlaylistId: string | null;
  onSelectPlaylist: (id: string) => void;
  activeRailItem: string; onRailChange: (item: string) => void;
  expanded: boolean; onToggleExpanded: () => void;
  panelWidth?: number;
  pinnedIds: Set<string>; onTogglePin: (id: string) => void;
  onOpenSettings: () => void;
  onAddToFolderClick: (item: Playlist) => void;
  onNewPlaylist: () => void;
}

export default function LibrarySidebar({
  playlists, activePlaylistId, onSelectPlaylist,
  activeRailItem, onRailChange, expanded, onToggleExpanded, panelWidth = 220,
  pinnedIds, onTogglePin, onOpenSettings, onAddToFolderClick, onNewPlaylist,
}: LibrarySidebarProps) {
  const [sectionsOpen, setSectionsOpen] = useState({ repos: true, importer: false });
  const toggle = (k: keyof typeof sectionsOpen) => setSectionsOpen(s => ({ ...s, [k]: !s[k] }));

  const sorted  = [...playlists].sort((a, b) => (pinnedIds.has(a.id) ? 0 : 1) - (pinnedIds.has(b.id) ? 0 : 1));
  const pinned  = sorted.filter(p => pinnedIds.has(p.id));
  const unpinned = sorted.filter(p => !pinnedIds.has(p.id));

  return (
    <div className="flex h-full">
      {/* Icon rail */}
      <div style={{
        width: 48, background: 'var(--bg-0)',
        borderRight: '1px solid var(--border-0)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '8px 0', gap: 4, flexShrink: 0,
      }}>
        <RailIcon icon={<IcoMenu size={14} />}     title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggleExpanded} />
        <RailIcon icon={<IcoLibrary size={14} />}   active={activeRailItem === 'playlists'} onClick={() => onRailChange('playlists')} title="Playlists — browse playlists & tracks" />
        <RailIcon icon={<IcoMusicLib size={14} />}  active={activeRailItem === 'library'}   onClick={() => onRailChange('library')}   title="Library — all tracks on this machine" />
        <RailIcon icon={<IcoHistory size={14} />}  active={activeRailItem === 'history'} onClick={() => onRailChange('history')} title="Listening History — play log & skip stats" />
        <RailIcon icon={<IcoGit size={14} />}      active={activeRailItem === 'git'}     onClick={() => onRailChange('git')}     title="Commit Graph — playlist version history" />
        <RailIcon icon={<IcoSync size={14} />}     active={activeRailItem === 'sync'}    onClick={() => onRailChange('sync')}    title="Sync — push/pull with upstream remote" />
        <RailIcon icon={<IcoEditor size={14} />}   active={activeRailItem === 'editor'}  onClick={() => onRailChange('editor')} title="Editor — modify track metadata & MP3 tags" />
        <div style={{ flex: 1 }} />
        <RailIcon icon={<IcoDownload size={14} />} active={activeRailItem === 'import'}  onClick={() => onRailChange('import')}  title="Import" />
        <RailIcon icon={<IcoMetrics size={14} />}  active={activeRailItem === 'metrics'} onClick={() => onRailChange('metrics')} title="Metrics" />
        <RailIcon icon={<IcoSettings size={14} />} active={activeRailItem === 'settings'} onClick={onOpenSettings} title="Settings" />
      </div>

      {/* Library tree */}
      <div style={{
        width: expanded ? panelWidth : 0,
        background: 'var(--bg-1)',
        borderRight: expanded ? '1px solid var(--border-0)' : 'none',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div className="px-3 py-2 border-b border-mm-b0 shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-mm-t2 uppercase whitespace-nowrap">Playlists</span>
          <button
            onClick={onNewPlaylist}
            title="New playlist"
            className="btn btn-ghost btn-xs btn-square text-mm-t2 hover:text-mm-accent"
          >+</button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll">
          {/* Repositories section */}
          <div>
            <button
              onClick={() => toggle('repos')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold tracking-[0.08em] text-mm-t2 uppercase hover:text-mm-t1 transition-colors"
            >
              <span>Repositories</span>
              <IcoChevron size={9} style={{ transform: sectionsOpen.repos ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {sectionsOpen.repos && (
              <div>
                {pinned.length > 0 && (
                  <div className="flex items-center gap-1 px-3 py-0.5 text-[9px] font-bold uppercase tracking-widest text-mm-accent-dim">
                    <IcoPin filled size={9} /> Pinned
                  </div>
                )}
                {pinned.map(p => (
                  <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
                    onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
                    pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                    onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit} />
                ))}
                {pinned.length > 0 && unpinned.length > 0 && <div className="h-px bg-mm-b0 mx-2.5 my-1" />}
                {unpinned.map(p => (
                  <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
                    onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
                    pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                    onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit} />
                ))}
              </div>
            )}
          </div>

          {/* Importer section */}
          <CollapsibleSection label="Importer" open={sectionsOpen.importer} onToggle={() => toggle('importer')}>
            <div className="px-3 pb-2 space-y-1.5">
              <p className="text-[11px] text-mm-t2">yt-dlp URL</p>
              <input
                placeholder="https://youtube.com/..."
                className="input input-xs w-full bg-mm-3 text-mm-t1 font-['Outfit']"
              />
              <button className="btn btn-ghost btn-xs btn-block">Download &amp; Import</button>
              <button className="btn btn-ghost btn-xs btn-block">Import Local Files</button>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
