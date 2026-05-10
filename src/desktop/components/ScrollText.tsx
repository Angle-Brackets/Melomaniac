import { useRef, useState } from 'react';

interface ScrollTextProps {
  text:       string;
  style?:     React.CSSProperties;
  textStyle?: React.CSSProperties;
  className?: string;
}

const GAP = 60; // px between the two copies

/**
 * Renders text with overflow ellipsis normally.
 * On hover, if the text is actually truncated, runs a seamless marquee:
 * two copies side-by-side scroll left continuously — no jump-back.
 */
export default function ScrollText({ text, style, textStyle, className }: ScrollTextProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [textW, setTextW] = useState(0);
  const [anim, setAnim]   = useState(false);

  return (
    <div
      ref={outerRef}
      className={className}
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0, ...style }}
      onMouseEnter={() => {
        const outer = outerRef.current;
        const inner = innerRef.current;
        if (!outer || !inner) return;
        const overflow = inner.scrollWidth - outer.clientWidth;
        if (overflow > 4) { setTextW(inner.scrollWidth); setAnim(true); }
      }}
      onMouseLeave={() => setAnim(false)}
    >
      {anim ? (
        <span
          style={{
            display: 'inline-flex',
            gap: `${GAP}px`,
            animation: `mm-marquee ${Math.max(2, (textW + GAP) / 80).toFixed(2)}s linear 0.4s infinite`,
            ['--mm-dist' as string]: `${-(textW + GAP)}px`,
            ...textStyle,
          }}
        >
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{text}</span>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{text}</span>
        </span>
      ) : (
        <span
          ref={innerRef}
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...textStyle,
          }}
        >
          {text}
        </span>
      )}
    </div>
  );
}
