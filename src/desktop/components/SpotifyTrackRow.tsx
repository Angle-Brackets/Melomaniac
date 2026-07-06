// Spotify-provenance row pieces shared between LibraryView's flat track grid
// (task #6) and SpotifyPlaylistView's virtual-playlist list (task #7) — pulled
// out once both needed the same "matched vs external" rendering instead of
// growing a second inline copy.

import { FiDownloadCloud, FiSlash, FiPlay, FiAlertTriangle, FiCheck, FiTrash2, FiLoader } from 'react-icons/fi';
import { FaSpotify } from 'react-icons/fa';
import ScrollText from './ScrollText';
import type { SpotifyRow } from '../../store/spotifySlice';

// ── Provenance badge ──────────────────────────────────────────────────────────
// An icon rather than a text pill — a "SPOTIFY" label on every row got noisy
// fast once a playlist itself already establishes the provenance (see
// `showBadge` below); this only needs to read at a glance.

export function SpotifyProvenanceBadge({ downloading }: { downloading?: boolean }) {
  return (
    <span
      title={downloading ? 'Fetching from Spotify…' : 'From Spotify'}
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: downloading ? 'var(--text-3)' : '#1DB954' }}
    >
      {downloading ? <FiLoader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FaSpotify size={12} />}
    </span>
  );
}

// ── Context-menu items ────────────────────────────────────────────────────────

const menuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '7px 14px', border: 'none', background: 'transparent',
  color: 'var(--text-1)', fontSize: 12, cursor: 'pointer',
  textAlign: 'left', fontFamily: "'Outfit', sans-serif",
};

export function GetTrackMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={menuItemStyle}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-4)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <FiDownloadCloud size={11} />Get track
    </button>
  );
}

// "Reject" both unlinks and permanently blacklists the hash so the matcher
// can never re-suggest it for this track again — for a link that's actively
// wrong, not just undesired. Applies regardless of the confidence score the
// matcher originally reported.
export function RejectSpotifyMatchMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={menuItemStyle}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-4)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <FiSlash size={11} />Reject Spotify match
    </button>
  );
}

// ── Full row (used by SpotifyPlaylistView's flat, non-grid list) ─────────────

const GRADIENT_FALLBACK = 'radial-gradient(ellipse at 35% 35%, var(--bg-5) 0%, var(--bg-2) 100%)';

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface SpotifyTrackRowProps {
  row:           SpotifyRow;
  artworkUrl?:   string;
  isPlaying?:    boolean;
  isDownloading?: boolean;
  showBadge?:    boolean;
  onPlay:        (hash: string) => void;
  onGetTrack:    (spotifyId: string) => void;
  onReject:      (spotifyId: string, hash: string) => void;
  onKeepReview:    (spotifyId: string) => void;
  onDiscardReview: (spotifyId: string) => void;
}

export default function SpotifyTrackRow({ row, artworkUrl, isPlaying, isDownloading, showBadge = true, onPlay, onGetTrack, onReject, onKeepReview, onDiscardReview }: SpotifyTrackRowProps) {
  if (row.kind === 'review') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', height: 44,
        border: '1px dashed var(--warn, #c9a227)',
      }}>
        <FiAlertTriangle size={14} style={{ color: 'var(--warn, #c9a227)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ScrollText text={row.review.title} style={{ minWidth: 0 }} textStyle={{ fontSize: 12, color: 'var(--text-1)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
            Downloaded {fmtDuration(row.review.actualMs)}, expected {fmtDuration(row.review.expectedMs)} — wrong track?
          </span>
        </div>
        <button
          onClick={() => onKeepReview(row.review.spotifyId)}
          title="Keep anyway"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', color: 'var(--accent-light)', fontSize: 10.5, cursor: 'pointer', fontFamily: "'Outfit', sans-serif", flexShrink: 0 }}
        >
          <FiCheck size={10} />Keep
        </button>
        <button
          onClick={() => onDiscardReview(row.review.spotifyId)}
          title="Discard and retry later"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', color: 'var(--text-3)', fontSize: 10.5, cursor: 'pointer', fontFamily: "'Outfit', sans-serif", flexShrink: 0 }}
        >
          <FiTrash2 size={10} />Discard
        </button>
      </div>
    );
  }

  const isExternal = row.kind === 'external';
  const title      = isExternal ? row.record.title       : row.track.title;
  const artist     = isExternal ? row.record.artist      : row.track.artist;
  const album      = isExternal ? row.record.album       : row.track.album;
  const duration   = isExternal ? row.record.duration_ms : row.track.duration_ms;
  const spotifyId  = isExternal ? row.record.provider_track_id  : row.spotifyId;
  const hash       = isExternal ? undefined              : row.track.hash;

  return (
    <div
      onDoubleClick={() => { if (!isExternal) onPlay(row.track.hash); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', height: 40,
        cursor: isExternal ? 'default' : 'pointer',
        border: isExternal ? '1px dashed var(--border-2)' : undefined,
        borderBottom: isExternal ? undefined : '1px solid var(--border-0)',
        borderLeft: isPlaying ? '2px solid var(--accent-light)' : '2px solid transparent',
        opacity: isExternal ? 0.85 : 1,
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 3, flexShrink: 0, overflow: 'hidden',
        background: artworkUrl && !isPlaying ? undefined : GRADIENT_FALLBACK,
        border: '1px solid var(--border-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isPlaying
          ? <FiPlay size={11} style={{ color: 'var(--accent-light)' }} />
          : artworkUrl
            ? <img src={artworkUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : null}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <ScrollText text={title} style={{ flex: '0 1 auto', minWidth: 0 }} textStyle={{ fontSize: 12, color: isPlaying ? 'var(--accent-light)' : 'var(--text-1)' }} />
          {showBadge && <SpotifyProvenanceBadge downloading={isDownloading} />}
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {artist}{album ? ` · ${album}` : ''}
        </span>
      </div>

      <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-3)', flexShrink: 0 }}>
        {fmtDuration(duration)}
      </span>

      {isExternal ? (
        <button
          onClick={() => spotifyId && onGetTrack(spotifyId)}
          disabled={isDownloading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 5,
            background: 'var(--bg-4)', border: '1px solid var(--border-2)',
            color: 'var(--accent-light)', fontSize: 10.5, cursor: isDownloading ? 'default' : 'pointer',
            fontFamily: "'Outfit', sans-serif", flexShrink: 0,
          }}
        >
          <FiDownloadCloud size={10} />{isDownloading ? 'Fetching…' : 'Get track'}
        </button>
      ) : (
        <span className="mm-tip-wrap" style={{ flexShrink: 0 }}>
          <button
            onClick={() => spotifyId && hash && onReject(spotifyId, hash)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-3)', padding: '4px', borderRadius: 3,
            }}
          >
            <FiSlash size={11} />
          </button>
          <span className="mm-tip">
            Reject Spotify match — keeps the downloaded file, just unlinks it and blocks this pairing from being suggested again
          </span>
        </span>
      )}
    </div>
  );
}
