import React from 'react';
import { FaWeightHanging } from 'react-icons/fa';
import { FaMagnifyingGlass } from 'react-icons/fa6';

interface IconProps {
  size?: number;
  stroke?: string;
  fill?: string;
}

const Ic = ({
  d,
  size = 22,
  stroke = 'currentColor',
  fill = 'none',
  w = 1.7,
  children,
  vb = '0 0 24 24',
}: {
  d?: string;
  size?: number;
  stroke?: string;
  fill?: string;
  w?: number;
  children?: React.ReactNode;
  vb?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox={vb}
    fill={fill}
    stroke={stroke}
    strokeWidth={w}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d ? <path d={d} /> : children}
  </svg>
);

export const Icons = {
  library: (p: IconProps) => <Ic {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ic>,
  stack: (p: IconProps) => <Ic {...p}><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/></Ic>,
  playCircle: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><path d="M10 8.5l6 3.5-6 3.5V8.5z" fill="currentColor"/></Ic>,
  sparkles: (p: IconProps) => <Ic {...p}><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 16l.8 1.7L21.5 18.5l-1.7.8L19 21l-.8-1.7L16.5 18.5l1.7-.8L19 16z"/></Ic>,
  gear: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 005 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></Ic>,
  play: (p: IconProps) => <Ic {...p}><path d="M6 4l14 8-14 8V4z" fill="currentColor"/></Ic>,
  pause: (p: IconProps) => <Ic {...p} fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="0.5" fill="currentColor" stroke="none"/></Ic>,
  prev: (p: IconProps) => <Ic {...p}><path d="M19 4L9 12l10 8V4z" fill="currentColor"/><rect x="4" y="4" width="2" height="16" rx="0.4" fill="currentColor" stroke="none"/></Ic>,
  next: (p: IconProps) => <Ic {...p}><path d="M5 4l10 8-10 8V4z" fill="currentColor"/><rect x="18" y="4" width="2" height="16" rx="0.4" fill="currentColor" stroke="none"/></Ic>,
  skipBack: (p: IconProps) => <Ic {...p} vb="0 0 28 24"><path d="M13 6L4 12l9 6V6z" fill="currentColor"/><path d="M22 6l-9 6 9 6V6z" fill="currentColor"/><text x="14" y="15" fontSize="6.5" textAnchor="middle" fontWeight="600" fill="currentColor" stroke="none">10</text></Ic>,
  skipFwd: (p: IconProps) => <Ic {...p} vb="0 0 28 24"><path d="M15 6l9 6-9 6V6z" fill="currentColor"/><path d="M6 6l9 6-9 6V6z" fill="currentColor"/><text x="14" y="15" fontSize="6.5" textAnchor="middle" fontWeight="600" fill="currentColor" stroke="none">10</text></Ic>,
  shuffle: (p: IconProps) => <Ic {...p}><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/><path d="M21 16v5h-5"/><path d="M14 14l7 7"/><path d="M3 3l7 7"/></Ic>,
  shuffleRandom: (p: IconProps) => <Ic {...p}><rect x="2" y="2" width="20" height="20" rx="3.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></Ic>,
  shuffleWeighted: ({ size = 22 }: IconProps) => <FaWeightHanging size={size}/>,
  shuffleDiscovery: ({ size = 22 }: IconProps) => <FaMagnifyingGlass size={size}/>,
  loop: (p: IconProps) => <Ic {...p}><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></Ic>,
  loopOne: (p: IconProps) => <Ic {...p}><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="12" y="14.5" fontSize="7" textAnchor="middle" fontWeight="700" fill="currentColor" stroke="none">1</text></Ic>,
  ab: (p: IconProps) => <Ic {...p}><path d="M3 18l4-12 4 12M4.5 14h5"/><path d="M14 6h3.5a2.5 2.5 0 010 5H14V6zm0 5h4a2.5 2.5 0 010 5h-4v-5z"/></Ic>,
  heart: (p: IconProps) => <Ic {...p}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></Ic>,
  heartFill: (p: IconProps) => <Ic {...p} fill="currentColor"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></Ic>,
  queue: (p: IconProps) => <Ic {...p}><path d="M3 6h13M3 12h13M3 18h9"/><path d="M18 14l5 4-5 4v-8z" fill="currentColor"/></Ic>,
  search: (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Ic>,
  more: (p: IconProps) => <Ic {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></Ic>,
  moreV: (p: IconProps) => <Ic {...p}><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></Ic>,
  grip: (p: IconProps) => <Ic {...p}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></Ic>,
  branch: (p: IconProps) => <Ic {...p}><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 6v12"/><path d="M18 10c0 3.3-5.3 4-12 4"/></Ic>,
  fork: (p: IconProps) => <Ic {...p}><circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 6v3a3 3 0 003 3h6a3 3 0 003-3V6"/><path d="M12 12v6"/></Ic>,
  merge: (p: IconProps) => <Ic {...p}><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="14" r="2"/><path d="M6 6v12"/><path d="M18 12c-6 0-6-6-12-6"/></Ic>,
  commit: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3.5"/><path d="M2 12h6.5M15.5 12H22"/></Ic>,
  history: (p: IconProps) => <Ic {...p}><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-7 3L3 3"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/></Ic>,
  sync: (p: IconProps) => <Ic {...p}><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/><path d="M3 21v-5h5"/></Ic>,
  download: (p: IconProps) => <Ic {...p}><path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></Ic>,
  paste: (p: IconProps) => <Ic {...p}><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h3a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h3"/></Ic>,
  plus: (p: IconProps) => <Ic {...p}><path d="M12 5v14M5 12h14"/></Ic>,
  check: (p: IconProps) => <Ic {...p}><path d="M5 12l5 5L20 6"/></Ic>,
  x: (p: IconProps) => <Ic {...p}><path d="M6 6l12 12M18 6L6 18"/></Ic>,
  chevDown: (p: IconProps) => <Ic {...p}><path d="M6 9l6 6 6-6"/></Ic>,
  chevRight: (p: IconProps) => <Ic {...p}><path d="M9 6l6 6-6 6"/></Ic>,
  chevLeft: (p: IconProps) => <Ic {...p}><path d="M15 6l-6 6 6 6"/></Ic>,
  edit: (p: IconProps) => <Ic {...p}><path d="M4 20h4l11-11-4-4L4 16v4z"/></Ic>,
  trash: (p: IconProps) => <Ic {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></Ic>,
  alert: (p: IconProps) => <Ic {...p}><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/></Ic>,
  upload: (p: IconProps) => <Ic {...p}><path d="M12 21V8"/><path d="M7 13l5-5 5 5"/><path d="M4 4h16"/></Ic>,
  wave: (p: IconProps) => <Ic {...p}><path d="M2 12h2l2-7 3 14 2-10 2 7 2-4 3 5 2-3 2 1"/></Ic>,
  filter: (p: IconProps) => <Ic {...p}><path d="M4 5h16M7 12h10M10 19h4"/></Ic>,
  wifi: (p: IconProps) => <Ic {...p}><path d="M5 12.5a10 10 0 0114 0"/><path d="M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></Ic>,
};
