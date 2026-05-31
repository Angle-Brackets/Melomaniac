export interface ParsedTitle {
  title:   string;
  variant: string | null;
  album:   string | null;
  tag:     string | null;
}

export function parseTrackTitle(raw: string): ParsedTitle {
  if (!raw) return { title: '', variant: null, album: null, tag: null };
  const m = raw.match(/^(.+?)(?:\s*\(([^)]+)\))?(?:\s*[-–—]\s*(.+?))?(?:\s*\[([^\]]+)\])?$/);
  if (!m) return { title: raw, variant: null, album: null, tag: null };
  return {
    title:   (m[1] ?? raw).trim(),
    variant: m[2]?.trim() ?? null,
    album:   m[3]?.trim() ?? null,
    tag:     m[4]?.trim() ?? null,
  };
}
