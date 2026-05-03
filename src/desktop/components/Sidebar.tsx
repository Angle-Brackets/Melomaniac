import { useState } from 'react';
import type { Playlist } from '../data';

// ── Icon definitions ──────────────────────────────────────────────────────────
const ICONS = {
  menu:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect y="2" width="14" height="1.5" rx="0.75"/><rect y="6.25" width="14" height="1.5" rx="0.75"/><rect y="10.5" width="14" height="1.5" rx="0.75"/></svg>,
  library:  () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="0" width="4" height="14" rx="1"/><rect x="5" y="0" width="4" height="14" rx="1"/><rect x="10" y="3" width="4" height="11" rx="1"/></svg>,
  clock:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v3.5l2 1.5" strokeLinecap="round"/></svg>,
  branch:   () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="11" r="1.5"/><circle cx="10" cy="5" r="1.5"/><path d="M4 4.5v5" strokeLinecap="round"/><path d="M4 4.5C4 7 10 7 10 6.5" strokeLinecap="round"/></svg>,
  download: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 2v7M4 6.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" strokeLinecap="round"/></svg>,
  chart:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="7" width="3" height="7" rx="0.5"/><rect x="4" y="4" width="3" height="10" rx="0.5"/><rect x="8" y="1" width="3" height="13" rx="0.5"/><rect x="12" y="5" width="2" height="9" rx="0.5"/></svg>,
  git:      () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="11" r="1.5"/><circle cx="10" cy="5" r="1.5"/><path d="M4 4.5v5" strokeLinecap="round"/><path d="M4 4.5C4 7 10 7 10 5" strokeLinecap="round"/></svg>,
  settings: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="7" cy="7" r="2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.75 2.75l1.06 1.06M10.19 10.19l1.06 1.06M2.75 11.25l1.06-1.06M10.19 3.81l1.06-1.06"/></svg>,
  edit:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/><path d="M8 4l2 2"/></svg>,
  sync:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 7a5 5 0 0 1 9-3M12 7a5 5 0 0 1-9 3" strokeLinecap="round"/><path d="M11 1v3h-3M3 13v-3H6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  pin:      (filled: boolean) => <svg width="11" height="11" viewBox="0 0 11 11" fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "currentColor"} strokeWidth="1.3"><path d="M6.5 1l3.5 3.5-1.5 1.5L7 5.5 5 9l-3-3 3.5-2L4.5 3z" strokeLinejoin="round"/><path d="M1 10l2.5-2.5" strokeLinecap="round"/></svg>,
  chevron:  (open: boolean) => <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><path d="M3 2l3 2.5-3 2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ── RailIcon ──────────────────────────────────────────────────────────────────
interface RailIconProps {
  icon: () => JSX.Element;
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
        {icon()}
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

// ── PinButton ─────────────────────────────────────────────────────────────────
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
      }}
    >
      {ICONS.pin(pinned)}
    </div>
  );
}

// ── AddToFolderPopup ──────────────────────────────────────────────────────────
interface FolderItem { id: number; name: string; }

interface AddToFolderPopupProps {
  item: Playlist;
  folders: FolderItem[];
  onClose: () => void;
  onAddToFolder: (itemId: number, folderId: number) => void;
  onCreateFolder: (name: string, itemId: number) => void;
}

export function AddToFolderPopup({ item, folders, onClose, onAddToFolder, onCreateFolder }: AddToFolderPopupProps) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(8,5,2,0.7)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 280, background: 'var(--bg-2)', borderRadius: 9,
        border: '1px solid var(--border-2)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-0)', background: 'var(--bg-0)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)' }}>Add "{item.name}" to folder</div>
        </div>
        <div style={{ padding: '8px 0' }}>
          {folders.length > 0 && (
            <>
              <div style={{ padding: '2px 14px 5px', fontSize: 9, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Existing folders</div>
              {folders.map(f => (
                <div key={f.id} onClick={() => { onAddToFolder(item.id, f.id); onClose(); }}
                  style={{ padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 7 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-4)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 13 }}>📁</span> {f.name}
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border-0)', margin: '5px 10px' }} />
            </>
          )}
          {!creating ? (
            <div onClick={() => setCreating(true)}
              style={{ padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 7 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-4)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>+</span> Create new folder…
            </div>
          ) : (
            <div style={{ padding: '6px 14px', display: 'flex', gap: 6 }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Folder name"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) { onCreateFolder(newName.trim(), item.id); onClose(); }
                  if (e.key === 'Escape') setCreating(false);
                }}
                style={{ flex: 1, background: 'var(--bg-3)', border: '1px solid var(--accent-dim)', borderRadius: 4, padding: '4px 7px', fontSize: 11, color: 'var(--text-0)', outline: 'none', fontFamily: "'Outfit', sans-serif" }} />
              <button
                onClick={() => { if (newName.trim()) { onCreateFolder(newName.trim(), item.id); onClose(); } }}
                style={{ padding: '4px 9px', borderRadius: 4, fontSize: 10, cursor: 'pointer', border: '1px solid var(--accent-dim)', background: 'var(--bg-5)', color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif" }}
              >Create</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PlaylistRow ───────────────────────────────────────────────────────────────
interface PlaylistRowProps {
  item: Playlist;
  activeId: number;
  depth: number;
  onSelect: (id: number) => void;
  defaultOpen?: boolean;
  pinnedIds: Set<number>;
  onTogglePin: (id: number) => void;
  onAddToFolderClick: (item: Playlist) => void;
  synced: boolean;
}

function PlaylistRow({ item, activeId, depth, onSelect, defaultOpen, pinnedIds, onTogglePin, onAddToFolderClick, synced }: PlaylistRowProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [hov, setHov] = useState(false);
  const isActive = item.id === activeId;
  const isPinned = pinnedIds.has(item.id);
  const hasChildren = !!item.children?.length;

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <div
        onClick={() => { hasChildren ? setOpen(!open) : onSelect(item.id); }}
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {hasChildren && <span style={{ color: 'var(--text-2)', flexShrink: 0 }}>{ICONS.chevron(open)}</span>}
            {isPinned && <span style={{ flexShrink: 0, opacity: 0.7 }}>{ICONS.pin(true)}</span>}
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
            <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 1, paddingLeft: hasChildren || isPinned ? 13 : 0 }}>
              {item.commit} · {item.synced}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, paddingTop: 1 }}>
          {synced && !item.pull && item.commit && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <title>Up to date</title>
              <path d="M2 5l2.2 2.2L8 3"/>
            </svg>
          )}
          {item.pull && (
            <span style={{ fontSize: 9, background: 'var(--accent-dim)', color: 'var(--accent-light)', padding: '1px 4px', borderRadius: 3, fontFamily: "'JetBrains Mono', monospace" }}>pull?</span>
          )}
          {(hov || isPinned) && (
            <PinButton pinned={isPinned} onToggle={() => onTogglePin(item.id)} />
          )}
          {hov && (
            <span
              onClick={e => { e.stopPropagation(); onAddToFolderClick(item); }}
              style={{ color: 'var(--text-2)', opacity: 0.6, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Add to folder"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="4.25" y="0" width="1.5" height="10" rx="0.75"/><rect x="0" y="4.25" width="10" height="1.5" rx="0.75"/></svg>
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

// ── CollapsibleSection ────────────────────────────────────────────────────────
function CollapsibleSection({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-0)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          color: 'var(--text-2)', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
      >
        <span>{label}</span>
        <span>{ICONS.chevron(open)}</span>
      </div>
      {open && children}
    </div>
  );
}

// ── LibrarySidebar ────────────────────────────────────────────────────────────
interface LibrarySidebarProps {
  playlists: Playlist[];
  activePlaylistId: number;
  onSelectPlaylist: (id: number) => void;
  activeRailItem: string;
  onRailChange: (item: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  pinnedIds: Set<number>;
  onTogglePin: (id: number) => void;
  onOpenSettings: () => void;
  onAddToFolderClick: (item: Playlist) => void;
}

export default function LibrarySidebar({
  playlists, activePlaylistId, onSelectPlaylist,
  activeRailItem, onRailChange, expanded, onToggleExpanded,
  pinnedIds, onTogglePin, onOpenSettings, onAddToFolderClick,
}: LibrarySidebarProps) {
  const [sectionsOpen, setSectionsOpen] = useState({ repos: true, importer: false });
  const toggle = (k: keyof typeof sectionsOpen) => setSectionsOpen(s => ({ ...s, [k]: !s[k] }));

  const sorted = [...playlists].sort((a, b) => (pinnedIds.has(a.id) ? 0 : 1) - (pinnedIds.has(b.id) ? 0 : 1));
  const pinned = sorted.filter(p => pinnedIds.has(p.id));
  const unpinned = sorted.filter(p => !pinnedIds.has(p.id));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* icon rail */}
      <div style={{
        width: 48, background: 'var(--bg-0)',
        borderRight: '1px solid var(--border-0)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '8px 0', gap: 4, flexShrink: 0,
      }}>
        <RailIcon icon={ICONS.menu} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggleExpanded} />
        <RailIcon icon={ICONS.library} active={activeRailItem === 'library'} onClick={() => onRailChange('library')} title="Library — browse playlists & tracks" />
        <RailIcon icon={ICONS.clock}   active={activeRailItem === 'history'} onClick={() => onRailChange('history')} title="Listening History — play log & skip stats" />
        <RailIcon icon={ICONS.git}     active={activeRailItem === 'git'}     onClick={() => onRailChange('git')}     title="Commit Graph — playlist version history" />
        <RailIcon icon={ICONS.sync}    active={activeRailItem === 'sync'}    onClick={() => onRailChange('sync')}    title="Sync — push/pull with upstream remote" />
        <RailIcon icon={ICONS.edit}    active={activeRailItem === 'editor'}  onClick={() => onRailChange('editor')} title="Editor — modify track metadata & MP3 tags" />
        <div style={{ flex: 1 }} />
        <RailIcon icon={ICONS.download} active={activeRailItem === 'import'}  onClick={() => onRailChange('import')}  title="Import" />
        <RailIcon icon={ICONS.chart}    active={activeRailItem === 'metrics'} onClick={() => onRailChange('metrics')} title="Metrics" />
        <RailIcon icon={ICONS.settings} active={activeRailItem === 'settings'} onClick={onOpenSettings} title="Settings" />
      </div>

      {/* library tree */}
      <div style={{
        width: expanded ? 220 : 0,
        background: 'var(--bg-1)',
        borderRight: expanded ? '1px solid var(--border-0)' : 'none',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
        flexShrink: 0,
      }}>
        <div style={{
          padding: '8px 12px 6px',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: 'var(--text-2)', textTransform: 'uppercase',
          borderBottom: '1px solid var(--border-0)', flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>Library</div>

        <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
          <div>
            <div
              onClick={() => toggle('repos')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 12px', cursor: 'pointer',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                color: 'var(--text-2)', textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
            >
              <span>Repositories</span>
              <span>{ICONS.chevron(sectionsOpen.repos)}</span>
            </div>

            {sectionsOpen.repos && (
              <div>
                {pinned.length > 0 && (
                  <div style={{ padding: '3px 12px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent-dim)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {ICONS.pin(true)} Pinned
                  </div>
                )}
                {pinned.map(p => (
                  <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
                    onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
                    pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                    onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit} />
                ))}
                {pinned.length > 0 && unpinned.length > 0 && (
                  <div style={{ height: 1, background: 'var(--border-0)', margin: '3px 10px' }} />
                )}
                {unpinned.map(p => (
                  <PlaylistRow key={p.id} item={p} activeId={activePlaylistId} depth={0}
                    onSelect={onSelectPlaylist} defaultOpen={p.id === activePlaylistId}
                    pinnedIds={pinnedIds} onTogglePin={onTogglePin}
                    onAddToFolderClick={onAddToFolderClick} synced={!p.pull && !!p.commit} />
                ))}
              </div>
            )}
          </div>

          <CollapsibleSection label="Importer" open={sectionsOpen.importer} onToggle={() => toggle('importer')}>
            <div style={{ padding: '6px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>yt-dlp URL</div>
              <input placeholder="https://youtube.com/..." style={{
                width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                borderRadius: 4, padding: '5px 7px', fontSize: 10, color: 'var(--text-1)',
                fontFamily: "'Outfit', sans-serif", outline: 'none',
              }} />
              <button style={{
                marginTop: 5, width: '100%', padding: '4px 0',
                background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                borderRadius: 4, fontSize: 10, color: 'var(--text-1)',
                cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
              }}>Download &amp; Import</button>
              <button style={{
                marginTop: 4, width: '100%', padding: '4px 0',
                background: 'transparent', border: '1px solid var(--border-1)',
                borderRadius: 4, fontSize: 10, color: 'var(--text-2)',
                cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
              }}>Import Local Files</button>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
