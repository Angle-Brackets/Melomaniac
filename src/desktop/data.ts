export interface Album {
  id: number;
  title: string;
  artist: string;
  gradient: string;
  accent: string;
  artworkUrl?: string | null;
}

export interface Track {
  id: number;
  /** CAS hash — set for real tracks, empty string for mock/placeholder tracks */
  hash: string;
  artwork_hash: string | null;
  duration_ms: number;
  title: string;
  artist: string;
  album: string;
  commit: string;
  added: string;
  length: string;
  albumRef: number;
  ingested_at?: number;
  source_url?:  string | null;
}

/** Shape returned by the `library_get_all` Tauri command (mirrors TrackRecord in Rust) */
export interface TrackRecord {
  hash:         string;
  title:        string;
  artist:       string;
  album:        string | null;
  artwork_hash: string | null;
  duration_ms:  number;
  favorited:    boolean;
  mime_type:    string | null;
  ingested_at:  number;
  source_url:   string | null;
}

export interface Playlist {
  id: number;
  name: string;
  version: string | null;
  commit: string | null;
  synced: string | null;
  branch: string | null;
  pinned: boolean;
  pull?: boolean;
  children?: Playlist[];
}

export interface Commit {
  hash: string;
  msg: string;
  author: string;
  time: string;
  branch: string;
  parents: string[];
  tags: string[];
}

export const ALBUMS: Album[] = [
  { id: 1, title: "Rainy Window",        artist: "Lorun",       gradient: "radial-gradient(ellipse at 28% 22%, #5a7aaa 0%, #2a4a72 35%, #0e2038 70%, #060e1e 100%)", accent: "#5a7aaa" },
  { id: 2, title: "Coffee Shop Ambience", artist: "Anna Bair",  gradient: "radial-gradient(ellipse at 62% 28%, #c8946a 0%, #7a4522 40%, #3a1a08 72%, #180c04 100%)", accent: "#c8946a" },
  { id: 3, title: "Sunset Drift",        artist: "Study Beats", gradient: "radial-gradient(ellipse at 50% 60%, #e0843a 0%, #9a3e0a 30%, #1e0808 62%, #281828 100%)", accent: "#e0843a" },
  { id: 4, title: "Midnight Bloom",      artist: "Anna Bair",   gradient: "radial-gradient(ellipse at 68% 32%, #9a60c0 0%, #4e1e72 45%, #1c0830 80%, #0a0418 100%)", accent: "#9a60c0" },
  { id: 5, title: "Ember",               artist: "Various",     gradient: "radial-gradient(ellipse at 42% 52%, #d4521c 0%, #8a2208 35%, #3c0808 65%, #140404 100%)", accent: "#d4521c" },
  { id: 6, title: "Forest Dawn",         artist: "Lorun",       gradient: "radial-gradient(ellipse at 35% 35%, #4a8a5a 0%, #1e4a2a 42%, #0a1e10 72%, #040a06 100%)", accent: "#4a8a5a" },
  { id: 7, title: "Neon Shore",          artist: "Study Beats", gradient: "radial-gradient(ellipse at 55% 45%, #3a8ac0 0%, #1a4870 38%, #080e24 70%, #040812 100%)", accent: "#3a8ac0" },
];

export const TRACKS: Track[] = [
  { id: 1, hash: '', artwork_hash: null, duration_ms: 0, title: "Chill Ambient",        artist: "Anna Bair",   album: "Chill Ruests",   commit: "4fa9b0", added: "2h ago",  length: "24:20", albumRef: 1 },
  { id: 2, hash: '', artwork_hash: null, duration_ms: 0, title: "Coffee Terpomarai",    artist: "Lorun",       album: "Coffee Shop A.", commit: "4fa9b0", added: "5h ago",  length: "23:35", albumRef: 1 },
  { id: 3, hash: '', artwork_hash: null, duration_ms: 0, title: "Denny Wrock Before",   artist: "Study Beats", album: "Coffee Shop A.", commit: "4fa9b0", added: "1d ago",  length: "23:57", albumRef: 2 },
  { id: 4, hash: '', artwork_hash: null, duration_ms: 0, title: "Coffee Shop Ambienc.", artist: "Anna Bair",   album: "Coffee Shop A.", commit: "4fa9b0", added: "1d ago",  length: "23:19", albumRef: 2 },
  { id: 5, hash: '', artwork_hash: null, duration_ms: 0, title: "Sunset Keys",          artist: "Lorun",       album: "Sunset Drift",   commit: "9c2a31", added: "3d ago",  length: "18:44", albumRef: 2 },
  { id: 6, hash: '', artwork_hash: null, duration_ms: 0, title: "Rain on Glass",        artist: "Anna Bair",   album: "Rainy Window",   commit: "9c2a31", added: "3d ago",  length: "31:02", albumRef: 0 },
  { id: 7, hash: '', artwork_hash: null, duration_ms: 0, title: "Midnight Protocol",    artist: "Study Beats", album: "Midnight Bloom", commit: "b7f192", added: "5d ago",  length: "22:11", albumRef: 3 },
  { id: 8, hash: '', artwork_hash: null, duration_ms: 0, title: "Ember Walk",           artist: "Various",     album: "Ember",          commit: "b7f192", added: "5d ago",  length: "19:55", albumRef: 4 },
];

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Convert a backend TrackRecord into the display Track type. */
export function trackRecordToTrack(r: TrackRecord, idx: number): Track {
  return {
    id:           idx + 1,
    hash:         r.hash,
    artwork_hash: r.artwork_hash,
    duration_ms:  r.duration_ms,
    title:        r.title,
    artist:       r.artist,
    album:        r.album ?? 'Unknown Album',
    commit:       r.hash.slice(0, 6),
    added:        '—',
    length:       fmtDuration(r.duration_ms),
    albumRef:     parseInt(r.hash[0], 16) % ALBUMS.length,
    ingested_at:  r.ingested_at,
    source_url:   r.source_url,
  };
}

export const PLAYLISTS: Playlist[] = [
  { id: 1, name: "Cozy Melodies",  version: "1.5", commit: "3ed5b0", synced: "2h ago", branch: "main", pinned: false },
  { id: 2, name: "Study Beats",    version: "3.0", commit: "4fa9b0", synced: "2h ago", branch: "main", pull: true, pinned: true },
  { id: 3, name: "Lo-Fi Lounge",   version: "2.1", commit: "3ed5b0", synced: "2h ago", branch: "main", pinned: false },
  {
    id: 4, name: "Gaming Sessions", version: null, commit: null, synced: null, branch: null, pinned: false,
    children: [
      { id: 5, name: "Chill Games", version: null, commit: "4fa9b0", synced: "2h ago", branch: "main", pinned: false },
      { id: 6, name: "Fast Pace",   version: null, commit: "4fa9b0", synced: "2h ago", branch: "main", pinned: false },
    ],
  },
];

export const COMMITS: Commit[] = [
  { hash: "4fa9b0", msg: "Add Coffee Shop Ambience + Rainy Window", author: "you",      time: "2h ago", branch: "main", parents: ["9c2a31"],           tags: ["HEAD", "main"] },
  { hash: "9c2a31", msg: "Merge branch dev → main",                  author: "you",      time: "1d ago", branch: "main", parents: ["b7f192", "8e2b44"], tags: [] },
  { hash: "8e2b44", msg: "Reorder: move ambient tracks to top",      author: "device-2", time: "2d ago", branch: "dev",  parents: ["c91f33"],           tags: [] },
  { hash: "c91f33", msg: "Experiment: fast-paced gaming section",    author: "you",      time: "3d ago", branch: "dev",  parents: ["b7f192"],           tags: ["dev"] },
  { hash: "b7f192", msg: "Import Sunset Drift + Midnight Bloom",     author: "you",      time: "5d ago", branch: "main", parents: ["3ed5b0"],           tags: [] },
  { hash: "3ed5b0", msg: "Fork from Lo-Fi Lounge v2.0",              author: "you",      time: "2w ago", branch: "main", parents: [],                  tags: ["upstream/main"] },
];

export const CHART_BARS = [4, 6, 3, 8, 5, 9, 7, 5, 6, 8, 4, 7];
export const CHART_LINE = [3, 5, 4, 7, 6, 9, 8, 6, 7, 9, 7, 8];

export const BRANCH_COLS: Record<string, number> = { main: 0, dev: 1 };
export const BRANCH_COLORS: Record<string, string> = { main: "var(--accent)", dev: "var(--blue)" };
