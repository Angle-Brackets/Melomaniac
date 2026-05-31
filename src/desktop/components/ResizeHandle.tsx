import type React from 'react';

interface ResizeHandleProps {
  direction: 'h' | 'v';
  onDelta: (delta: number) => void;
}

export default function ResizeHandle({ direction, onDelta }: ResizeHandleProps) {
  const isH = direction === 'h';

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = isH ? e.clientX : e.clientY;

    const onMove = (ev: MouseEvent) => {
      const cur = isH ? ev.clientX : ev.clientY;
      onDelta(cur - last);
      last = cur;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    // Override body cursor so the resize cursor persists when the pointer outruns the handle element
    document.body.style.cursor = isH ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width:  isH ? 5 : '100%',
        height: isH ? '100%' : 5,
        cursor: isH ? 'col-resize' : 'row-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        background: 'transparent',
      }}
      onMouseEnter={e => { (e.currentTarget.firstElementChild as HTMLElement).style.background = 'var(--accent)'; }}
      onMouseLeave={e => { (e.currentTarget.firstElementChild as HTMLElement).style.background = 'var(--border-0)'; }}
    >
      <div style={{
        width:  isH ? 1 : '100%',
        height: isH ? '100%' : 1,
        background: 'var(--border-0)',
        transition: 'background 0.15s',
        pointerEvents: 'none',
      }} />
    </div>
  );
}
