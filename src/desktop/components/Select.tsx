import { useState, useRef, useEffect } from 'react';
import { FiChevronDown } from 'react-icons/fi';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value:         string;
  options:       SelectOption[];
  onChange:      (value: string) => void;
  size?:         'sm' | 'md';
  mono?:         boolean;
  accentColor?:  string | null;
  minWidth?:     number;
  placeholder?:  string;
  disabled?:     boolean;
}

export function Select({
  value, options, onChange,
  size = 'md', mono = false, accentColor = null,
  minWidth, placeholder, disabled = false,
}: SelectProps) {
  const [open, setOpen]   = useState(false);
  const ref               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected  = options.find(o => o.value === value);
  const label     = selected?.label ?? placeholder ?? value;
  const isSm      = size === 'sm';
  const font      = mono ? "'JetBrains Mono', monospace" : "'Outfit', sans-serif";
  const fontSize  = isSm ? 11 : 12;
  const color     = accentColor ?? (selected ? 'var(--text-1)' : 'var(--text-3)');

  const triggerStyle: React.CSSProperties = {
    display:        'flex',
    alignItems:     'center',
    gap:            isSm ? 3 : 5,
    padding:        isSm ? '3px 7px' : '6px 10px',
    background:     open ? 'var(--bg-4)' : 'var(--bg-2)',
    border:         '1px solid var(--border-1)',
    borderRadius:   isSm ? 4 : 5,
    cursor:         disabled ? 'not-allowed' : 'pointer',
    outline:        'none',
    fontFamily:     font,
    fontSize,
    color,
    opacity:        disabled ? 0.5 : 1,
    transition:     'background 0.1s, border-color 0.1s',
    minWidth,
    whiteSpace:     'nowrap',
  };

  const panelStyle: React.CSSProperties = {
    position:     'absolute',
    top:          '100%',
    left:         0,
    marginTop:    3,
    background:   'var(--bg-3)',
    border:       '1px solid var(--border-2)',
    borderRadius: isSm ? 5 : 6,
    boxShadow:    '0 6px 20px rgba(0,0,0,0.55)',
    zIndex:       500,
    minWidth:     '100%',
    overflow:     'hidden',
    animation:    'fadeInScale 0.1s ease',
  };

  const itemBase: React.CSSProperties = {
    padding:    isSm ? '5px 10px' : '7px 12px',
    fontSize,
    fontFamily: font,
    cursor:     'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        style={triggerStyle}
        onClick={() => !disabled && setOpen(o => !o)}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-1)'; }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        <FiChevronDown
          size={isSm ? 9 : 11}
          style={{
            color: 'var(--text-3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div style={panelStyle}>
          {options.map(opt => {
            const isActive = opt.value === value;
            return (
              <div
                key={opt.value}
                style={{
                  ...itemBase,
                  color:      isActive ? 'var(--accent-light)' : 'var(--text-1)',
                  background: isActive ? 'var(--bg-4)'         : 'transparent',
                }}
                onMouseEnter={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-4)';
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
