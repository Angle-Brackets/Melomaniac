import { useEffect, useRef, useState } from 'react';

export const ACCENT_FALLBACK: [string, string] = ['#d4803c', '#c06070'];

/** Returns accent colors derived from the current CSS theme variables. */
export function getCSSAccentFallback(): [string, string] {
  try {
    const s = getComputedStyle(document.documentElement);
    const a = s.getPropertyValue('--accent').trim();
    const l = s.getPropertyValue('--accent-light').trim();
    if (a && l) return [a, l];
  } catch { /* before DOM ready */ }
  return ACCENT_FALLBACK;
}

// Keyed by data-URL so the same artwork blob is only sampled once per session.
const accentsByUrl = new Map<string, [string, string]>();
const inflight     = new Map<string, Promise<[string, string]>>();

function bucketToHex(b: { r: number; g: number; b: number; weight: number }): string {
  const r  = Math.round((b.r / b.weight) * 255);
  const g  = Math.round((b.g / b.weight) * 255);
  const bl = Math.round((b.b / b.weight) * 255);
  return '#' + [r, g, bl].map(x => x.toString(16).padStart(2, '0')).join('');
}

function shiftHue(hex: string, deg: number): string {
  const h  = hex.replace('#', '');
  const r  = parseInt(h.slice(0, 2), 16) / 255;
  const g  = parseInt(h.slice(2, 4), 16) / 255;
  const b  = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l  = (mx + mn) / 2;
  const d  = mx - mn;
  const s  = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue  = 0;
  if (d !== 0) {
    if      (mx === r) hue = ((g - b) / d) % 6;
    else if (mx === g) hue = (b - r) / d + 2;
    else               hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  hue = ((hue + deg) % 360 + 360) % 360;
  const c2 = (1 - Math.abs(2 * l - 1)) * s;
  const x2 = c2 * (1 - Math.abs((hue / 60) % 2 - 1));
  const m2 = l - c2 / 2;
  let r2 = 0, g2 = 0, b2 = 0;
  if      (hue < 60)  { r2 = c2; g2 = x2; b2 = 0; }
  else if (hue < 120) { r2 = x2; g2 = c2; b2 = 0; }
  else if (hue < 180) { r2 = 0;  g2 = c2; b2 = x2; }
  else if (hue < 240) { r2 = 0;  g2 = x2; b2 = c2; }
  else if (hue < 300) { r2 = x2; g2 = 0;  b2 = c2; }
  else               { r2 = c2; g2 = 0;  b2 = x2; }
  const toHex = (v: number) => Math.round((v + m2) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

// Sample a 48×48 downscale, bucket by hue (30° buckets), weight toward saturated
// mid-light pixels. Returns the top-2 distinct colors (≥60° apart in hue).
export async function extractAccents(src: string): Promise<[string, string]> {
  if (accentsByUrl.has(src)) return accentsByUrl.get(src)!;
  if (inflight.has(src))     return inflight.get(src)!;

  const p = (async (): Promise<[string, string]> => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('load failed'));
    });
    const W = 48, H = 48;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l  = (mx + mn) / 2;
      if (l < 0.12 || l > 0.92) continue;
      const d  = mx - mn;
      const s  = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s < 0.18) continue;
      let hh = 0;
      if (d !== 0) {
        if      (mx === r) hh = ((g - b) / d) % 6;
        else if (mx === g) hh = (b - r) / d + 2;
        else               hh = (r - g) / d + 4;
        hh *= 60; if (hh < 0) hh += 360;
      }
      const key = Math.floor(hh / 30);
      const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
      const w   = s * (1 - Math.abs(l - 0.55) * 1.2);
      cur.r += r * w; cur.g += g * w; cur.b += b * w;
      cur.weight += w;
      buckets.set(key, cur);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[1].weight - a[1].weight);
    if (sorted.length === 0) return ACCENT_FALLBACK;
    const [bestKey, best] = sorted[0];
    const primary = bucketToHex(best);
    const secondEntry = sorted.find(([k]) =>
      Math.min(Math.abs(k - bestKey), 12 - Math.abs(k - bestKey)) >= 2
    );
    const secondary = secondEntry ? bucketToHex(secondEntry[1]) : shiftHue(primary, 150);
    const result: [string, string] = [primary, secondary];
    accentsByUrl.set(src, result);
    return result;
  })();

  inflight.set(src, p);
  p.finally(() => inflight.delete(src));
  return p;
}

/** React hook: resolves accent colors from a data-URL, with in-session caching. */
export function useAccentsFromUrl(url: string | null | undefined): [string, string] {
  const [accents, setAccents] = useState<[string, string]>(
    url ? (accentsByUrl.get(url) ?? ACCENT_FALLBACK) : ACCENT_FALLBACK
  );
  useEffect(() => {
    if (!url) { setAccents(ACCENT_FALLBACK); return; }
    const cached = accentsByUrl.get(url);
    if (cached) { setAccents(cached); return; }
    let alive = true;
    extractAccents(url).then(pair => {
      if (!alive) return;
      setAccents(pair);
    }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return accents;
}

/**
 * Cross-fades between two radial-gradient glow states when accent colors change.
 * Render both slots as position:absolute divs with `opacity: activeSlot === i ? 1 : 0`
 * and `transition: opacity Xs ease` — CSS can't animate gradients directly, so
 * we keep two overlapping divs and cross-fade their opacities instead.
 */
export function useGlowFade(accents: [string, string]): {
  slots: [[string, string], [string, string]];
  activeSlot: number;
} {
  const slotRef = useRef(0);
  const prevRef = useRef(accents);
  const [slots, setSlots] = useState<[[string, string], [string, string]]>([accents, accents]);
  const [activeSlot, setActiveSlot] = useState(0);

  useEffect(() => {
    if (accents[0] === prevRef.current[0] && accents[1] === prevRef.current[1]) return;
    prevRef.current = accents;
    const next = 1 - slotRef.current;
    setSlots(prev => {
      const copy: [[string, string], [string, string]] = [prev[0], prev[1]];
      copy[next] = accents;
      return copy;
    });
    // Double rAF: inactive slot's new gradient is painted before the cross-fade triggers
    requestAnimationFrame(() => requestAnimationFrame(() => {
      slotRef.current = next;
      setActiveSlot(next);
    }));
  }, [accents]);

  return { slots, activeSlot };
}

export function withAlpha(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) {
    return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
  }
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
