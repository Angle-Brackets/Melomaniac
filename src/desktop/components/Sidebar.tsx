import { useState } from 'react';
import { useStore } from '../../store';
import type { Playlist } from '../data';
import {
  IcoMenu, IcoLibrary, IcoMusicLib, IcoHistory, IcoBranch,
  IcoEditor, IcoSettings, IcoPin, IcoChevron, IcoDiscover,
} from '../icons';

// ── Rail icon with tooltip ────────────────────────────────────────────────────
interface RailIconProps {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}

function RailIcon({ icon, active = false, onClick, title, disabled = false }: RailIconProps) {
  const [hovered, setHovered] = useState(false);
  const [label, sub] = (title ?? '').split(' — ');
  return (
    <div
      className="rail-icon-wrap"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : undefined }}
    >
      <div style={{
        width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
        color: active ? 'var(--accent-light)' : hovered && !disabled ? 'var(--text-1)' : 'var(--text-2)',
        background: active ? 'var(--bg-5)' : hovered && !disabled ? 'var(--bg-3)' : 'transparent',
        transition: 'all 0.14s',
      }}>
        {icon}
      </div>
      {title && (
        <div className="rail-tooltip">
          <span style={{ color: 'var(--text-0)', fontWeight: 600 }}>{label}</span>
          {sub && <span style={{ color: 'var(--text-2)', fontSize: 10, display: 'block', marginTop: 1 }}>{sub}</span>}
          {disabled && <span style={{ color: 'var(--text-3)', fontSize: 10, display: 'block', marginTop: 1 }}>Coming soon</span>}
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
  currentFolderId?: number;
  onClose: () => void;
  onAddToFolder: (itemId: string, folderId: number) => void;
  onCreateFolder: (name: string, itemId: string) => void;
  onRemoveFromFolder?: (itemId: string) => void;
}

export function AddToFolderPopup({ item, folders, currentFolderId, onClose, onAddToFolder, onCreateFolder, onRemoveFromFolder }: AddToFolderPopupProps): JSX.Element {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const currentFolder = folders.find(f => f.id === currentFolderId);
  const otherFolders = folders.filter(f => f.id !== currentFolderId);

  return (
    <dialog className="modal modal-open" style={{ zIndex: 300 }}>
      <div className="modal-box bg-mm-2 border border-mm-b2 max-w-xs p-0 overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-mm-b0 bg-mm-0">
          <p className="text-xs font-bold text-mm-t0">Add "{item.name}" to folder</p>
        </div>
        <div className="py-2">
          {currentFolder && (
            <>
              <p className="px-3.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-mm-t2">Current folder</p>
              <div className="flex items-center gap-1.5 px-3.5 py-1.5">
                <span className="text-xs text-mm-t1 flex-1">📁 {currentFolder.name}</span>
                {onRemoveFromFolder && (
                  <button
                    onClick={() => { onRemoveFromFolder(item.id); onClose(); }}
                    className="btn btn-ghost btn-xs text-error hover:bg-error/10 font-normal"
                  >Remove</button>
                )}
              </div>
              <div className="h-px bg-mm-b0 mx-2.5 my-1" />
            </>
          )}
          {otherFolders.length > 0 && (
            <>
              <p className="px-3.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-mm-t2">
                {currentFolder ? 'Move to' : 'Existing folders'}
              </p>
              {otherFolders.map(f => (
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
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}

function PlaylistRow({ item, activeId, depth, onSelect, defaultOpen, pinnedIds, onTogglePin, onAddToFolderClick, synced, onDragStart, onDragEnd }: PlaylistRowProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [hov, setHov] = useState(false);
  const isActive = item.id === activeId;
  const isPinned = pinnedIds.has(item.id);
  const hasChildren = !!item.children?.length;
  const pendingConflictPlaylists = useStore(s => s.pendingConflictPlaylists);
  const reopenConflict = useStore(s => s.reopenConflict);
  const hasConflict = pendingConflictPlaylists.includes(item.id);

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart ? e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.id);
          onDragStart(item.id);
        } : undefined}
        onDragEnd={onDragEnd}
        onClick={() => hasChildren ? setOpen(!open) : onSelect(item.id)}
        style={{
          padding: `5px 10px 5px ${10 + depth * 12}px`,
          cursor: onDragStart ? 'grab' : 'pointer',
          userSelect: 'none',
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
              <title>Up to date</title><path d="M2 5l2.2 2.2L8 3" />
            </svg>
          )}
          {item.pull && (
            <span className="font-mono text-[9px] bg-mm-accent-dim text-mm-accent-lit px-1 py-px rounded-sm">pull?</span>
          )}
          {hasConflict && (
            <span
              onClick={e => { e.stopPropagation(); reopenConflict(item.id) }}
              className="font-mono text-[9px] px-1 py-px rounded-sm cursor-pointer"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
              title="Merge conflict — click to resolve"
            >⚠️</span>
          )}
          {(hov || isPinned) && <PinButton pinned={isPinned} onToggle={() => onTogglePin(item.id)} />}
          {hov && (
            <span
              onClick={e => { e.stopPropagation(); onAddToFolderClick(item); }}
              className="text-mm-t2 opacity-60 cursor-pointer flex items-center"
              title="Add to folder"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <rect x="4.25" y="0" width="1.5" height="10" rx="0.75" />
                <rect x="0" y="4.25" width="10" height="1.5" rx="0.75" />
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
              onAddToFolderClick={onAddToFolderClick} synced={!child.pull && !!child.commit}
              onDragStart={onDragStart} onDragEnd={onDragEnd} />
          ))}
        </div>
      )}
    </div>
  );
}


// ── Folder row (collapsible group) ────────────────────────────────────────────
interface FolderRowProps {
  folder: FolderItem;
  playlists: Playlist[];
  activeId: string | null;
  onSelect: (id: string) => void;
  pinnedIds: Set<string>;
  onTogglePin: (id: string) => void;
  onAddToFolderClick: (item: Playlist) => void;
  onAssignToFolder: (playlistId: string, folderId: number) => void;
  onDeleteFolder: (folderId: number) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

function FolderRow({ folder, playlists, activeId, onSelect, pinnedIds, onTogglePin, onAddToFolderClick, onAssignToFolder, onDeleteFolder, onDragStart, onDragEnd }: FolderRowProps) {
  const [open, setOpen] = useState(true);
  const [dragCount, setDragCount] = useState(0);
  const isOver = dragCount > 0;

  return (
    <div
      onDragEnter={e => { e.preventDefault(); setDragCount(c => c + 1); }}
      onDragLeave={() => setDragCount(c => Math.max(0, c - 1))}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault(); setDragCount(0);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onAssignToFolder(id, folder.id);
      }}
      style={{
        borderRadius: 6,
        outline: isOver ? '1px solid var(--accent)' : '1px solid transparent',
        background: isOver ? 'var(--bg-3)' : 'transparent',
        transition: 'background 0.1s, outline-color 0.1s',
      }}
    >
      <div className="group/folder flex items-center px-3 py-1.5">
        {/* Collapse toggle */}
        <div
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center gap-1.5 cursor-pointer text-[10px] font-bold tracking-[0.08em] text-mm-t2 uppercase hover:text-mm-t1 transition-colors min-w-0"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" className="shrink-0 opacity-70">
            <path d="M1 3.5C1 2.67 1.67 2 2.5 2H4.62l1 1.5H9.5c.83 0 1.5.67 1.5 1.5V9c0 .83-.67 1.5-1.5 1.5h-7C1.67 10.5 1 9.83 1 9V3.5z" />
          </svg>
          <span className="flex-1 truncate">{folder.name}</span>
          <IcoChevron size={9} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
        {/* Delete button — shown on hover */}
        <button
          onClick={() => onDeleteFolder(folder.id)}
          title="Delete folder"
          className="opacity-0 group-hover/folder:opacity-100 transition-opacity btn btn-ghost btn-square shrink-0 text-mm-t3 hover:text-error"
          style={{ width: 20, height: 20, minHeight: 'unset', padding: 0 }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      </div>
      {open && playlists.map(p => (
        <PlaylistRow key={p.id} item={p} activeId={activeId} depth={1}
          onSelect={onSelect} defaultOpen={p.id === activeId}
          pinnedIds={pinnedIds} onTogglePin={onTogglePin}
          onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit}
          onDragStart={onDragStart} onDragEnd={onDragEnd} />
      ))}
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
  folders: FolderItem[];
  folderAssignments: Record<string, number>;
  onRemoveFromFolder: (playlistId: string) => void;
  onAssignToFolder: (playlistId: string, folderId: number | null) => void;
  onDeleteFolder: (folderId: number) => void;
  onOpenSettings: () => void;
  onAddToFolderClick: (item: Playlist) => void;
  onNewPlaylist: () => void;
  hasUpdate?: boolean;
}

export default function LibrarySidebar({
  playlists, activePlaylistId, onSelectPlaylist,
  activeRailItem, onRailChange, expanded, onToggleExpanded, panelWidth = 220,
  pinnedIds, onTogglePin, folders, folderAssignments, onAssignToFolder, onDeleteFolder,
  onOpenSettings, onAddToFolderClick, onNewPlaylist, hasUpdate,
}: LibrarySidebarProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [noFolderCount, setNoFolderCount] = useState(0);

  const pinned = playlists.filter(p => pinnedIds.has(p.id));
  const unassigned = playlists.filter(p => !pinnedIds.has(p.id) && folderAssignments[p.id] == null);

  const handleDragStart = (_id: string) => setIsDragging(true);
  const handleDragEnd = () => { setIsDragging(false); setNoFolderCount(0); };

  return (
    <div className="flex h-full">
      {/* Icon rail */}
      <div style={{
        width: 48, background: 'var(--bg-0)',
        borderRight: '1px solid var(--border-0)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '8px 0', gap: 4, flexShrink: 0,
      }}>
        <RailIcon icon={<IcoMenu size={14} />} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggleExpanded} />
        <RailIcon icon={<IcoLibrary size={14} />} active={activeRailItem === 'playlists'} onClick={() => onRailChange('playlists')} title="Playlists — browse playlists & tracks" />
        <RailIcon icon={<IcoMusicLib size={14} />} active={activeRailItem === 'library'} onClick={() => onRailChange('library')} title="Library — all tracks on this machine" />
        <RailIcon icon={<IcoHistory size={14} />} active={activeRailItem === 'history'} onClick={() => onRailChange('history')} title="Listening History — play log & skip stats" />
        <RailIcon icon={<IcoBranch size={14} />} active={activeRailItem === 'melo'} onClick={() => onRailChange('melo')} title="Commit Graph — playlist version history" />
        <RailIcon icon={<IcoEditor size={14} />} active={activeRailItem === 'editor'} onClick={() => onRailChange('editor')} title="Editor — modify track metadata & MP3 tags" />
        <RailIcon icon={<IcoDiscover size={23} />} disabled title="Discover — AI-powered music discovery" />
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <RailIcon icon={<IcoSettings size={14} />} active={activeRailItem === 'settings'} onClick={onOpenSettings} title="Settings" />
          {hasUpdate && (
            <div style={{
              position: 'absolute', top: 4, right: 4, width: 7, height: 7,
              borderRadius: '50%', background: 'var(--accent)',
              border: '1.5px solid var(--bg-0)', pointerEvents: 'none',
            }} />
          )}
        </div>
      </div>

      {/* Library tree */}
      <div style={{
        width: expanded ? panelWidth : 0,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border-0)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        flexShrink: 0,
        transition: 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
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

          {/* Pinned */}
          {pinned.length > 0 && (
            <div>
              <div className="flex items-center gap-1 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-mm-accent-dim">
                <IcoPin filled size={9} /> Pinned
              </div>
              {pinned.map(p => (
                <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
                  onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
                  pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                  onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit}
                  onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
              ))}
              {(folders.length > 0 || unassigned.length > 0) && <div className="h-px bg-mm-b0 mx-2.5 my-1" />}
            </div>
          )}

          {/* Folders */}
          {folders.map(folder => {
            const members = playlists.filter(p => !pinnedIds.has(p.id) && folderAssignments[p.id] === folder.id);
            return (
              <FolderRow key={folder.id} folder={folder} playlists={members}
                activeId={activePlaylistId} onSelect={onSelectPlaylist}
                pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                onAddToFolderClick={onAddToFolderClick}
                onAssignToFolder={onAssignToFolder}
                onDeleteFolder={onDeleteFolder}
                onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
            );
          })}

          {/* Unassigned */}
          {folders.length > 0 && unassigned.length > 0 && (
            <div className="h-px bg-mm-b0 mx-2.5 my-1" />
          )}
          {unassigned.map(p => (
            <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
              onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
              pinnedIds={pinnedIds} onTogglePin={onTogglePin}
              onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit}
              onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
          ))}

          {/* No-folder drop zone — only shown while dragging with folders present */}
          {isDragging && folders.length > 0 && (
            <div
              onDragEnter={e => { e.preventDefault(); setNoFolderCount(c => c + 1); }}
              onDragLeave={() => setNoFolderCount(c => Math.max(0, c - 1))}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault(); setNoFolderCount(0);
                const id = e.dataTransfer.getData('text/plain');
                if (id) { onAssignToFolder(id, null); setIsDragging(false); }
              }}
              style={{
                margin: '6px 10px',
                padding: '6px 10px',
                borderRadius: 5,
                border: `1px dashed ${noFolderCount > 0 ? 'var(--accent)' : 'var(--border-2)'}`,
                background: noFolderCount > 0 ? 'var(--bg-3)' : 'transparent',
                fontSize: 10, color: 'var(--text-3)',
                textAlign: 'center', transition: 'all 0.1s',
                cursor: 'copy',
              }}
            >
              No folder
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
