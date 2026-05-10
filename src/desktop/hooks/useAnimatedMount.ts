import { useState, useEffect } from 'react';

/**
 * Keeps a component mounted for `exitMs` after `visible` goes false so exit
 * animations can play. Returns `mounted` (controls whether to render) and
 * `closing` (true during the exit window — apply exit CSS class when true).
 */
export function useAnimatedMount(visible: boolean, exitMs = 160) {
  const [mounted,  setMounted]  = useState(visible);
  const [closing,  setClosing]  = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const id = setTimeout(() => { setMounted(false); setClosing(false); }, exitMs);
      return () => clearTimeout(id);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mounted, closing };
}
