export type Platform = 'desktop' | 'ios' | 'android';

function detect(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua))          return 'android';
  return 'desktop';
}

/** Resolved once at module load — synchronous, no async needed. */
export const platform: Platform = detect();

export const isMobile = platform === 'ios' || platform === 'android';
