import { useEffect, useState } from 'react';
import { useTrackArtwork } from './useTrackArtwork';

// Cache: trackHash → [primary, secondary] hex pair
const accentsByHash = new Map<string, [string, string]>();
const inflight = new Map<string, Promise<[string, string]>>();

const FALLBACK: [string, string] = ['#d4803c', '#c06070'];

function bucketToHex(b: { r: number; g: number; b: number; weight: number }): string {
  const r = Math.round((b.r / b.weight) * 255);
  const g = Math.round((b.g / b.weight) * 255);
  const bl = Math.round((b.b / b.weight) * 255);
  return '#' + [r, g, bl].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Rotate a hex color's hue by `deg` degrees, preserving saturation and lightness.
function shiftHue(hex: string, deg: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if      (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else                hue = (r - g) / d + 4;
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
  else                { r2 = c2; g2 = 0;  b2 = x2; }
  const toHex = (v: number) => Math.round((v + m2) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

// Sample a 48×48 downscale, bucket by hue (30° buckets), weight toward saturated
// mid-light pixels, return the top-2 distinct colors (at least 60° apart in hue).
// Falls back to hue-shifting primary by 150° when the image is monochromatic.
async function extractAccents(src: string): Promise<[string, string]> {
  if (inflight.has(src)) return inflight.get(src)!;
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
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (l < 0.12 || l > 0.92) continue;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s < 0.18) continue;
      let h = 0;
      if (d !== 0) {
        if      (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      const key = Math.floor(h / 30); // 12 buckets × 30°
      const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
      const w = s * (1 - Math.abs(l - 0.55) * 1.2); // prefer mid-light saturated
      cur.r += r * w; cur.g += g * w; cur.b += b * w;
      cur.weight += w;
      buckets.set(key, cur);
    }

    const sorted = [...buckets.entries()].sort((a, b) => b[1].weight - a[1].weight);
    if (sorted.length === 0) return FALLBACK;

    const [bestKey, best] = sorted[0];
    const primary = bucketToHex(best);

    // Second-best bucket at least 2 positions (60°) away — prevents same-family gradients
    const secondEntry = sorted.find(([k]) => Math.min(Math.abs(k - bestKey), 12 - Math.abs(k - bestKey)) >= 2);
    const secondary = secondEntry ? bucketToHex(secondEntry[1]) : shiftHue(primary, 150);

    return [primary, secondary];
  })();
  inflight.set(src, p);
  return p;
}

/** Returns [primary, secondary] accent colors extracted from the track's artwork. */
export function useTrackAccents(
  trackHash: string | null | undefined,
  artworkHash: string | null,
): [string, string] {
  const artUrl = useTrackArtwork(trackHash ?? '', artworkHash);
  const cached = trackHash ? accentsByHash.get(trackHash) : undefined;
  const [accents, setAccents] = useState<[string, string]>(cached ?? FALLBACK);

  useEffect(() => {
    if (!trackHash) { setAccents(FALLBACK); return; }
    const c = accentsByHash.get(trackHash);
    if (c) { setAccents(c); return; }
    if (!artUrl) { setAccents(FALLBACK); return; }
    let alive = true;
    extractAccents(artUrl).then(pair => {
      if (!alive) return;
      accentsByHash.set(trackHash, pair);
      setAccents(pair);
    }).catch(() => {});
    return () => { alive = false; };
  }, [trackHash, artUrl]);

  return accents;
}

/** Single dominant color — kept for callers that only need one. */
export function useTrackAccent(trackHash: string | null | undefined, artworkHash: string | null): string {
  return useTrackAccents(trackHash, artworkHash)[0];
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
