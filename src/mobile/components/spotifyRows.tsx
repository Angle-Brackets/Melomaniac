// Spotify-provenance row pieces shared between Library.tsx's flat track list
// (task #6) and SpotifyPlaylistDetail's virtual-playlist list (task #7) — pulled
// out once both needed the same "matched vs external" rendering instead of
// growing a second inline copy.

import { useRef } from 'react';
import type { SpotifyTrackRecord } from '../../store/types';
import type { SpotifyReviewTrack } from '../../store/spotifySlice';
import { Icons } from '../icons';
import { MMArt, MarqueeText } from './common';

const TRACK_H = 62;

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Small tag mirroring the desktop Library's `Badge` — used for the SPOTIFY
// provenance marker on both linked local rows and external (not-yet-fetched) rows.
export function MMBadge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0,
      padding: '1px 5px', borderRadius: 3,
      background: accent ? 'var(--accent-dim)' : 'var(--bg-4)',
      color:      accent ? 'var(--accent-light, var(--accent))' : 'var(--text-3)',
      border:     `1px solid ${accent ? 'var(--accent)' : 'var(--border-2)'}`,
      fontFamily: "'JetBrains Mono', monospace",
    }}>{label}</span>
  );
}

// ── ExternalTrackRow ──────────────────────────────────────────────────────────
// Imported-but-not-downloaded Spotify track. Dashed border distinguishes it
// from real library rows; not selectable/playable. Long-press opens the
// "Get track" action sheet (same gesture TrackRow uses for Add-to-Playlist).
export function ExternalTrackRow({ track, downloading, onLongPress }: {
  track: SpotifyTrackRecord; downloading: boolean; onLongPress: () => void;
}) {
  const subtext = [track.artist, track.album].filter(Boolean).join(' | ');
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLp = () => {
    lpTimer.current = setTimeout(() => { lpTimer.current = null; onLongPress(); }, 500);
  };
  const cancelLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  return (
    <div
      onPointerDown={e => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); startLp(); }}
      onPointerUp={cancelLp}
      onPointerCancel={cancelLp}
      onPointerMove={e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelLp(); }}
      style={{
        height: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', margin: '0 10px',
        borderRadius: 10, border: '1px dashed var(--border-2)', opacity: 0.85,
      }}>
      <MMArt src={track.artwork_url ?? undefined} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <MarqueeText
            text={track.title}
            active={false}
            style={{ flex: 1, minWidth: 0 }}
            textStyle={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}
          />
          <MMBadge label={downloading ? 'FETCHING…' : 'SPOTIFY'} accent/>
        </div>
        <MarqueeText
          text={subtext}
          active={false}
          style={{ marginTop: 1 }}
          textStyle={{ fontSize: 11.5, color: 'var(--text-2)' }}
        />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
        {fmtDuration(track.duration_ms)}
      </span>
    </div>
  );
}

// A downloaded track whose duration didn't match Spotify's closely enough to
// trust automatically (yt-dlp's top search hit can be a cover, extended mix,
// etc.) — held out of the normal link flow until the user taps Keep or Discard.
export function ReviewTrackRow({ review, onKeep, onDiscard }: {
  review: SpotifyReviewTrack; onKeep: () => void; onDiscard: () => void;
}) {
  return (
    <div style={{
      minHeight: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', margin: '0 10px',
      borderRadius: 10, border: '1px dashed var(--warn, #c9a227)',
    }}>
      <Icons.alert size={20} stroke="var(--warn, #c9a227)"/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MarqueeText
          text={review.title}
          active={false}
          textStyle={{ fontSize: 14, color: 'var(--text-0)', fontWeight: 500 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
          Got {fmtDuration(review.actualMs)}, expected {fmtDuration(review.expectedMs)} — wrong track?
        </span>
      </div>
      <button onClick={onKeep} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--bg-4)', border: '1px solid var(--border-2)', color: 'var(--accent-light, var(--accent))', fontSize: 12, flexShrink: 0 }}>
        Keep
      </button>
      <button onClick={onDiscard} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--bg-4)', border: '1px solid var(--border-2)', color: 'var(--text-2)', fontSize: 12, flexShrink: 0 }}>
        Discard
      </button>
    </div>
  );
}

// Long-press action sheet for an external Spotify row — a single "Get track" action.
export function GetTrackSheet({ label, downloading, onGetTrack, onClose }: {
  label: string; downloading: boolean; onGetTrack: () => void; onClose: () => void;
}) {
  return (
    <button
      onClick={() => { onGetTrack(); onClose(); }}
      disabled={downloading}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '12px 0', background: 'none', border: 'none', cursor: downloading ? 'default' : 'pointer',
        color: 'inherit', opacity: downloading ? 0.5 : 1,
      }}
    >
      <Icons.download size={17} stroke="var(--accent)"/>
      <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 500 }}>
        {downloading ? `Fetching "${label}"…` : `Get "${label}"`}
      </span>
    </button>
  );
}
