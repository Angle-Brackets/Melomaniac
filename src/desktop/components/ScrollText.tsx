import { useRef, useState } from 'react';

interface ScrollTextProps {
  text:       string;
  style?:     React.CSSProperties; // applied to the outer (layout) container
  textStyle?: React.CSSProperties; // applied to the inner text span (font, color, weight)
  className?: string;
}

/**
 * Renders text with overflow ellipsis normally.
 * On hover, if the text is actually truncated, scrolls it back-and-forth
 * so the full string is visible — no tooltip needed.
 */
export default function ScrollText({ text, style, textStyle, className }: ScrollTextProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [ov, setOv]     = useState(0);
  const [anim, setAnim] = useState(false);

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
        if (overflow > 4) { setOv(overflow); setAnim(true); }
      }}
      onMouseLeave={() => setAnim(false)}
    >
      <span
        ref={innerRef}
        style={anim ? {
          display: 'inline-block',
          animation: `mm-scroll ${Math.max(2, 1 + ov / 50).toFixed(2)}s linear 0.3s infinite`,
          ['--mm-ov' as string]: `-${ov}px`,
          ...textStyle,
        } : {
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...textStyle,
        }}
      >
        {text}
      </span>
    </div>
  );
}
