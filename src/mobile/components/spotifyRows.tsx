// Spotify-provenance row pieces shared between Library.tsx's flat track list
// (task #6) and SpotifyPlaylistDetail's virtual-playlist list (task #7) — pulled
// out once both needed the same "matched vs external" rendering instead of
// growing a second inline copy.

import { FaSpotify } from 'react-icons/fa';
import { FiLoader } from 'react-icons/fi';
import type { SpotifyTrackRecord } from '../../store/types';
import type { SpotifyReviewTrack } from '../../store/spotifySlice';
import { platform } from '../../shared/platform';
import { Icons } from '../icons';
import { MMArt, MarqueeText } from './common';

const TRACK_H = 62;

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Spotify provenance marker — an icon rather than a text pill, since a
// "SPOTIFY" label on every single row got noisy fast once a whole playlist
// view already establishes the provenance (see `showBadge` on ExternalTrackRow).
export function MMBadge({ downloading }: { downloading?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: downloading ? 'var(--text-3)' : '#1DB954' }}>
      {downloading ? <FiLoader size={13} style={{ animation: 'mmSpin 1s linear infinite' }} /> : <FaSpotify size={14} />}
    </span>
  );
}

// ── ExternalTrackRow ──────────────────────────────────────────────────────────
// Imported-but-not-downloaded Spotify track. Dashed border distinguishes it
// from real library rows; not selectable/playable. Tap opens the "Get track"
// action sheet.
export function ExternalTrackRow({ track, downloading, showBadge = true, onPress }: {
  track: SpotifyTrackRecord; downloading: boolean; showBadge?: boolean; onPress: () => void;
}) {
  const subtext = [track.artist, track.album].filter(Boolean).join(' | ');
  return (
    <div
      onClick={onPress}
      style={{
        // padding is 11px shorter than a plain row's 16px to offset this row's
        // extra margin + border so artwork/text/duration line up with
        // SpotifyLocalRow's (no margin, no border) in the same list.
        height: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 5px', margin: '0 10px',
        borderRadius: 10, border: '1px dashed var(--border-2)', opacity: 0.85, cursor: 'pointer',
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
          {showBadge && <MMBadge downloading={downloading}/>}
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
      minHeight: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 5px', margin: '0 10px',
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

// Action sheet for an external Spotify row — a single "Get track" action.
// Downloading shells out to a bundled yt-dlp sidecar binary, which iOS's app
// sandbox can't run and which tauri.ios.conf.json deliberately doesn't bundle
// (externalBin: []) — so on iOS this explains the limitation instead of
// offering a button that would just fail.
export function GetTrackSheet({ label, downloading, onGetTrack, onClose }: {
  label: string; downloading: boolean; onGetTrack: () => void; onClose: () => void;
}) {
  if (platform === 'ios') {
    return (
      <div style={{ padding: '4px 0 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Downloading isn't available on iOS. Download "{label}" on a desktop device, then sync to bring it here.
        </span>
        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end', padding: '6px 12px', borderRadius: 6,
            background: 'var(--bg-4)', border: '1px solid var(--border-2)',
            color: 'var(--text-1)', fontSize: 12.5,
          }}
        >
          Got it
        </button>
      </div>
    );
  }
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
