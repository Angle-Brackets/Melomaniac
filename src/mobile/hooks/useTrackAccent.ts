import { useEffect, useState } from 'react';
import { useTrackArtwork } from './useTrackArtwork';
import { extractAccents, withAlpha, useGlowFade, ACCENT_FALLBACK as FALLBACK } from '../../shared/artworkAccents';
export { withAlpha, useGlowFade };

// Cache: trackHash → [primary, secondary] hex pair
const accentsByHash = new Map<string, [string, string]>();

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

