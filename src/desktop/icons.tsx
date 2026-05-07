// Shared icon library.
// react-icons/fi (Feather) for standard UI actions; custom SVGs for
// music/git-specific shapes that have no Feather equivalent.
export {
  FiMenu        as IcoMenu,
  FiDisc        as IcoLibrary,
  FiMusic       as IcoMusicLib,
  FiClock       as IcoHistory,
  FiGitBranch   as IcoGit,
  FiDownload    as IcoDownload,
  FiBarChart2   as IcoMetrics,
  FiSettings    as IcoSettings,
  FiEdit2       as IcoEditor,
  FiRefreshCw   as IcoSync,
  FiPlay        as IcoPlay,
  FiPause       as IcoPause,
  FiSkipForward as IcoNext,
  FiSkipBack    as IcoPrev,
  FiShuffle     as IcoShuffle,
  FiRepeat      as IcoRepeat,
  FiHeart       as IcoHeart,
  FiVolume2     as IcoVolume,
  FiVolumeX     as IcoVolumeMute,
  FiChevronRight as IcoChevron,
  FiPlus        as IcoPlus,
  FiMoreVertical as IcoDots,
  FiX           as IcoClose,
  FiArrowUp     as IcoPush,
  FiList        as IcoQueue,
} from 'react-icons/fi';

// Pin — thumbtack shape, no Feather equivalent
export function IcoPin({ filled = false, size = 11 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.3">
      <path d="M6.5 1l3.5 3.5-1.5 1.5L7 5.5 5 9l-3-3 3.5-2L4.5 3z" strokeLinejoin="round"/>
      <path d="M1 10l2.5-2.5" strokeLinecap="round"/>
    </svg>
  );
}

// Drag handle — 2×3 dot grid
export function IcoDragHandle({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.4)} viewBox="0 0 10 14"
      fill="currentColor" className="opacity-30 cursor-grab shrink-0">
      <circle cx="3" cy="3"  r="1.3"/><circle cx="7" cy="3"  r="1.3"/>
      <circle cx="3" cy="7"  r="1.3"/><circle cx="7" cy="7"  r="1.3"/>
      <circle cx="3" cy="11" r="1.3"/><circle cx="7" cy="11" r="1.3"/>
    </svg>
  );
}

// Loop mode icon — changes visual based on current mode
export function IcoLoop({ mode }: { mode: 'off' | 'one' | 'ab' }) {
  if (mode === 'ab') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <text x="1.5" y="11.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="monospace">A</text>
        <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.5 1.5"/>
        <text x="9.5" y="11.5" fontSize="8" fontWeight="800" fill="currentColor" stroke="none" fontFamily="monospace">B</text>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h8v3l3-3-3-3v3"/>
      <path d="M12 12H4V9l-3 3 3 3v-3"/>
      {mode === 'one' && (
        <text x="6.5" y="10.5" fontSize="6" fontWeight="900"
          fill="currentColor" stroke="none" fontFamily="monospace">1</text>
      )}
    </svg>
  );
}
