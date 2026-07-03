export type Platform = 'desktop' | 'ios' | 'android';

function detect(): Platform {
  // Build-time override via VITE_PLATFORM=ios|android|desktop (set by dev:mobile script)
  const buildOverride = import.meta.env.VITE_PLATFORM;
  if (buildOverride === 'ios' || buildOverride === 'android' || buildOverride === 'desktop') {
    return buildOverride;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua))          return 'android';
  return 'desktop';
}

/** Resolved once at module load — synchronous, no async needed. */
export const platform: Platform = detect();

export const isMobile = platform === 'ios' || platform === 'android';

/** True on macOS desktop only (never iOS, which also reports "Mac" in some UAs). */
export const isMac = platform === 'desktop' && /Mac/.test(navigator.userAgent);
