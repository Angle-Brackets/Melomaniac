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
  /** Present only when returned by `playlist_get_tracks` — ms from tree manifest. */
  ab_start_ms?: number | null;
  ab_end_ms?:   number | null;
}

export interface Playlist {
  id: string;
  name: string;
  version: string | null;
  commit: string | null;
  synced: string | null;
  branch: string | null;
  pinned: boolean;
  pull?: boolean;
  children?: Playlist[];
}

// ── Backend mirror types (snake_case, match Rust structs) ─────────────────────

export interface BranchRecord {
  id:          string;
  playlist_id: string;
  name:        string;
  head_commit: string | null;
}

/** Shape returned by `playlist_get_all` / `playlist_create` / `playlist_fork`. */
export interface PlaylistRecord {
  id:                string;
  name:              string;
  description:       string | null;
  created_at:        number;
  forked_from:       string | null;
  forked_at_commit:  string | null;
  artwork_hash:      string | null;
  branches:          BranchRecord[];
}

export function playlistRecordToPlaylist(r: PlaylistRecord): Playlist {
  const main = r.branches.find(b => b.name === 'main') ?? r.branches[0];
  return {
    id:      r.id,
    name:    r.name,
    version: null,
    commit:  main?.head_commit?.slice(0, 7) ?? null,
    synced:  null,
    branch:  main?.name ?? 'main',
    pinned:  false,
  };
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

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timeAgo(unixSecs: number): string {
  if (!unixSecs) return '—';
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60)           return 'just now';
  if (diff < 3600)         return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)        return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 3 * 86400)   return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
    added:        timeAgo(r.ingested_at),
    length:       fmtDuration(r.duration_ms),
    albumRef:     parseInt(r.hash[0], 16) % ALBUMS.length,
    ingested_at:  r.ingested_at,
    source_url:   r.source_url,
  };
}

