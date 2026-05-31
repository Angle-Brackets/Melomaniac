import type React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

const THICKNESS = 6;

type ResizeDir = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

interface Edge {
  dir: ResizeDir;
  cursor: string;
  style: React.CSSProperties;
}

// Straight edges are inset by THICKNESS on each end so the corner squares don't overlap them
const EDGES: Edge[] = [
  { dir: 'North',     cursor: 'n-resize',  style: { top: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS } },
  { dir: 'South',     cursor: 's-resize',  style: { bottom: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS } },
  { dir: 'West',      cursor: 'w-resize',  style: { top: THICKNESS, bottom: THICKNESS, left: 0, width: THICKNESS } },
  { dir: 'East',      cursor: 'e-resize',  style: { top: THICKNESS, bottom: THICKNESS, right: 0, width: THICKNESS } },
  { dir: 'NorthWest', cursor: 'nw-resize', style: { top: 0, left: 0, width: THICKNESS, height: THICKNESS } },
  { dir: 'NorthEast', cursor: 'ne-resize', style: { top: 0, right: 0, width: THICKNESS, height: THICKNESS } },
  { dir: 'SouthWest', cursor: 'sw-resize', style: { bottom: 0, left: 0, width: THICKNESS, height: THICKNESS } },
  { dir: 'SouthEast', cursor: 'se-resize', style: { bottom: 0, right: 0, width: THICKNESS, height: THICKNESS } },
];

export default function WindowResizeEdges() {
  return (
    <>
      {EDGES.map(({ dir, cursor, style }) => (
        <div
          key={dir}
          onMouseDown={e => { e.preventDefault(); appWindow.startResizeDragging(dir); }}
          style={{
            position: 'fixed',
            zIndex: 9999,
            cursor,
            ...style,
          }}
        />
      ))}
    </>
  );
}
