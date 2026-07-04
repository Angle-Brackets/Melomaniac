import { useState } from 'react';
import { useStore } from '../../store';
import { useActiveSpotifyRows } from '../../store/useActiveSpotifyRows';
import type { SpotifyRow } from '../../store/spotifySlice';
import { IcoInfo, IcoDownloadAll, IcoPush } from '../icons';
import DesktopLoader from './DesktopLoader';
import SpotifyTrackRow, { SpotifyProvenanceBadge } from './SpotifyTrackRow';

interface SpotifyPlaylistViewProps {
  source:            string; // "liked" or "playlist:<id>"
  artworkUrls:        Record<string, string>;
  onPlayTrack:        (hash: string) => void;
}

// Main-panel view for a virtual (not-yet-fully-downloaded, or freshly-promoted)
// Spotify playlist — no branch/fork/merge controls, since those are meaningless
// for a source that isn't a real local playlist yet.
export default function SpotifyPlaylistView({ source, artworkUrls, onPlayTrack }: SpotifyPlaylistViewProps): JSX.Element {
  const [showInfo, setShowInfo] = useState(false);
  const [promoting, setPromoting] = useState(false);

  // Reflects the app-wide loaded track (not a locally-tracked "last hash played
  // from this view") so this row's highlight stays correct even if playback is
  // later changed from elsewhere (mini-player skip/prev, another view, etc).
  const loadedHash              = useStore(s => s.loadedTrackHash);
  const rows                   = useActiveSpotifyRows(source);
  const loading                = useStore(s => s.activeSpotifyLoading);
  const spotifyPlaylists       = useStore(s => s.spotifyPlaylists);
  const promotedSpotifySources = useStore(s => s.promotedSpotifySources);
  const downloadingSpotifyIds  = useStore(s => s.downloadingSpotifyIds);
  const downloadAndLink        = useStore(s => s.downloadAndLinkExternalTrack);
  const downloadAllTracks      = useStore(s => s.downloadAllTracks);
  const promotePlaylist        = useStore(s => s.promotePlaylist);
  const rejectMatch            = useStore(s => s.rejectMatch);
  const resolveReviewTrack     = useStore(s => s.resolveReviewTrack);

  const playlistMeta = source === 'liked' ? null : spotifyPlaylists.find(p => `playlist:${p.id}` === source) ?? null;
  const name          = source === 'liked' ? 'Liked Songs' : playlistMeta?.name ?? 'Spotify Playlist';
  const artworkSrc    = playlistMeta?.image_url ?? null;

  const linkedCount    = rows.filter(r => r.kind === 'local').length;
  const promoted       = promotedSpotifySources.includes(source);
  const fullyLinked    = rows.length > 0 && linkedCount === rows.length;
  const externalRows   = rows.filter((r): r is Extract<SpotifyRow, { kind: 'external' }> => r.kind === 'external');
  const anyDownloading = externalRows.some(r => downloadingSpotifyIds.includes(r.record.spotify_id));

  const handlePromote = async () => {
    setPromoting(true);
    try {
      await promotePlaylist(source);
    } catch (e) {
      console.error('promotePlaylist failed:', e);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-2)' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px 8px', borderBottom: '1px solid var(--border-0)',
        background: 'var(--bg-1)', flexShrink: 0,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
          background: artworkSrc ? undefined : 'radial-gradient(ellipse at 40% 30%, var(--accent-dim) 0%, var(--bg-4) 100%)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {artworkSrc && <img src={artworkSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              {name}
            </span>
            <SpotifyProvenanceBadge />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
            {promoted
              ? 'fully linked · promoted to a local playlist'
              : fullyLinked
              ? 'fully linked · can be promoted to a local playlist'
              : `${linkedCount} of ${rows.length} linked`}
          </div>
        </div>

        {!promoted && externalRows.length > 0 && (
          <button
            onClick={() => { downloadAllTracks(source).catch(console.error); }}
            disabled={anyDownloading}
            title="Download every unmatched track and link it"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '6px 11px', borderRadius: 6, border: '1px solid var(--border-2)',
              background: 'var(--bg-3)', color: 'var(--accent-light)',
              fontSize: 11.5, fontFamily: "'Outfit', sans-serif", fontWeight: 600,
              cursor: anyDownloading ? 'default' : 'pointer', opacity: anyDownloading ? 0.6 : 1,
            }}
          >
            <IcoDownloadAll size={13} />
            {anyDownloading ? 'Downloading…' : `Download All (${externalRows.length})`}
          </button>
        )}

        {!promoted && fullyLinked && (
          <button
            onClick={handlePromote}
            disabled={promoting}
            title="Create a real local playlist from these tracks"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '6px 11px', borderRadius: 6, border: '1px solid var(--accent)',
              background: 'var(--accent-dim)', color: 'var(--accent-light)',
              fontSize: 11.5, fontFamily: "'Outfit', sans-serif", fontWeight: 600,
              cursor: promoting ? 'default' : 'pointer', opacity: promoting ? 0.6 : 1,
            }}
          >
            <IcoPush size={13} />
            {promoting ? 'Promoting…' : 'Promote to Playlist'}
          </button>
        )}

        <button
          onClick={() => setShowInfo(true)}
          title="About Spotify playlists"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px', borderRadius: 3, flexShrink: 0 }}
        >
          <IcoInfo size={16} />
        </button>
      </div>

      {showInfo && (
        <dialog className="modal modal-open" style={{ zIndex: 60 }}>
          <div className="modal-box bg-mm-1 border border-mm-b2 max-w-sm p-5">
            <h3 className="font-bold text-sm text-mm-t0 mb-2.5">What's a Spotify playlist here?</h3>
            <div className="text-xs text-mm-t2 space-y-2 leading-relaxed">
              <p>This is a live view of a Spotify playlist, not a real Melomaniac playlist yet — there's no commit history, branches, or sync until it's promoted.</p>
              <p>Tracks Melomaniac already has locally are shown as normal rows. Anything else appears dashed with a "Get track" action — Melomaniac searches for and downloads it, then links it to the Spotify entry.</p>
              <p>If a download's length looks off from what Spotify reports, it's held for you to Keep or Discard instead of linking automatically.</p>
              <p>Once every track is linked, you can promote it into a real local playlist — with its name, artwork, and track order carried over. Promotion is manual, so you can also just download the tracks and skip it if you don't want a matching playlist entry.</p>
            </div>
            <button className="btn btn-sm btn-block mt-4" onClick={() => setShowInfo(false)}>Got it</button>
          </div>
          <div className="modal-backdrop bg-black/50 backdrop-blur-sm" onClick={() => setShowInfo(false)} />
        </dialog>
      )}

      {/* ── Rows ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <DesktopLoader />}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
            No tracks in this playlist
          </div>
        )}
        {!loading && rows.map(row => {
          const hash        = row.kind === 'local' ? row.track.hash : undefined;
          const spotifyId    = row.kind === 'local' ? row.spotifyId  : row.record.spotify_id;
          const isDownloading = downloadingSpotifyIds.includes(spotifyId);
          const spotifyArtworkUrl = row.kind === 'local' ? undefined : row.record.artwork_url ?? undefined;
          return (
            <SpotifyTrackRow
              key={spotifyId}
              row={row}
              artworkUrl={hash ? artworkUrls[hash] : spotifyArtworkUrl}
              isPlaying={!!hash && loadedHash === hash}
              isDownloading={isDownloading}
              onPlay={onPlayTrack}
              onGetTrack={id => downloadAndLink(id)}
              onReject={(id, h) => rejectMatch(id, h)}
              onKeepReview={id => resolveReviewTrack(id, 'keep')}
              onDiscardReview={id => resolveReviewTrack(id, 'discard')}
            />
          );
        })}
      </div>
    </div>
  );
}
