import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { useActiveSpotifyRows } from '../../store/useActiveSpotifyRows';
import type { SpotifyRow } from '../../store/spotifySlice';
import type { TrackRecord } from '../../store/types';
import { useTrackArtwork } from '../hooks/useTrackArtwork';
import { Icons } from '../icons';
import { MMArt, MMTabBar, MMSheet, MMLoader, MarqueeText } from './common';
import type { TabId } from './common';
import { MMBadge, ExternalTrackRow, GetTrackSheet, ReviewTrackRow } from './spotifyRows';
import { MiniPlayer } from './Library';

const TRACK_H = 62;

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Matched local track inside a virtual Spotify playlist — a simplified TrackRow
// variant with no select-mode/add-to-playlist sheet: tap to play, long-press
// to unlink the Spotify match.
function SpotifyLocalRow({ track, playing, onPlay, onLongPress }: {
  track: TrackRecord; playing: boolean; onPlay: () => void; onLongPress: () => void;
}) {
  const artworkUrl = useTrackArtwork(track.hash, track.artwork_hash);
  const subtext = [track.artist ?? 'Unknown artist', track.album].filter(Boolean).join(' | ');
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLp = () => { lpTimer.current = setTimeout(() => { lpTimer.current = null; onLongPress(); }, 500); };
  const cancelLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  return (
    <div
      onClick={onPlay}
      onPointerDown={e => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); startLp(); }}
      onPointerUp={cancelLp}
      onPointerCancel={cancelLp}
      onPointerMove={e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelLp(); }}
      style={{
        height: TRACK_H, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
        cursor: 'pointer',
        background: playing ? 'oklch(0.62 0.15 28 / 0.08)' : 'transparent',
        borderLeft: playing ? '2px solid var(--accent)' : '2px solid transparent',
      }}>
      <MMArt src={artworkUrl ?? undefined} size={42} radius={7}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <MarqueeText
            text={track.title}
            active={playing}
            style={{ flex: 1, minWidth: 0 }}
            textStyle={{ fontSize: 14, color: playing ? 'var(--accent)' : 'var(--text-0)', fontWeight: 500 }}
          />
          <MMBadge label="SPOTIFY"/>
        </div>
        <MarqueeText
          text={subtext}
          active={playing}
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

// Main-panel view for a virtual (not-yet-fully-downloaded, or freshly-promoted)
// Spotify playlist — no branch/commit UI, since those are meaningless for a
// source that isn't a real local playlist yet. Reuses the slide-in detail
// panel shell in MobileApp.tsx (mounted in place of PlaylistDetail).
export function SpotifyPlaylistDetail({ onBack, onTab }: { onBack: () => void; onTab: (id: TabId) => void }) {
  const activeSpotifySource          = useStore(s => s.activeSpotifySource);
  const activeSpotifyLoading         = useStore(s => s.activeSpotifyLoading);
  const rows                         = useActiveSpotifyRows(activeSpotifySource);
  const spotifyPlaylists             = useStore(s => s.spotifyPlaylists);
  const promotedSpotifySources       = useStore(s => s.promotedSpotifySources);
  const downloadingSpotifyIds        = useStore(s => s.downloadingSpotifyIds);
  const downloadAndLinkExternalTrack = useStore(s => s.downloadAndLinkExternalTrack);
  const downloadAllTracks            = useStore(s => s.downloadAllTracks);
  const promotePlaylist              = useStore(s => s.promotePlaylist);
  const rejectMatch                  = useStore(s => s.rejectMatch);
  const resolveReviewTrack           = useStore(s => s.resolveReviewTrack);
  const closeSpotifyPlaylist         = useStore(s => s.closeSpotifyPlaylist);

  const loadedHash                        = useStore(s => s.loadedTrackHash);
  const [externalSheet, setExternalSheet] = useState<{ spotifyId: string; label: string } | null>(null);
  const [rejectSheet, setRejectSheet]     = useState<{ spotifyId: string; hash: string; label: string } | null>(null);
  const [infoSheet, setInfoSheet]         = useState(false);
  const [promoting, setPromoting]         = useState(false);

  const playlistMeta = activeSpotifySource === 'liked' ? null : spotifyPlaylists.find(p => `playlist:${p.id}` === activeSpotifySource) ?? null;
  const name          = activeSpotifySource === 'liked' ? 'Liked Songs' : playlistMeta?.name ?? 'Spotify Playlist';
  const artworkSrc    = playlistMeta?.image_url ?? undefined;
  const linkedCount = rows.filter(r => r.kind === 'local').length;
  const promoted    = activeSpotifySource != null && promotedSpotifySources.includes(activeSpotifySource);
  const fullyLinked = rows.length > 0 && linkedCount === rows.length;
  const externalCount = rows.filter(r => r.kind === 'external').length;
  const anyDownloading = rows.some(r => r.kind === 'external' && downloadingSpotifyIds.includes(r.record.spotify_id));

  const handleBack = () => { closeSpotifyPlaylist(); onBack(); };

  const handlePromote = async () => {
    if (!activeSpotifySource) return;
    setPromoting(true);
    try {
      await promotePlaylist(activeSpotifySource);
    } catch (e) {
      console.error('promotePlaylist failed:', e);
    } finally {
      setPromoting(false);
    }
  };

  const playTrack = (hash: string) => {
    const track = rows.find((r): r is Extract<SpotifyRow, { kind: 'local' }> => r.kind === 'local' && r.track.hash === hash)?.track;
    if (!track) return;
    invoke('track_play', { hash }).catch(console.error);
    useStore.getState().setLoaded(hash, track.duration_ms);
    useStore.getState().setPlaying(true);
  };

  if (!activeSpotifySource) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        No Spotify playlist selected
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-1)', color: 'var(--text-0)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 'calc(16px + var(--safe-top)) 0 var(--tab-h)', overflowY: 'auto' }} className="mm-scroll">
        <div style={{ padding: '8px 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={handleBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}>
            <Icons.chevLeft size={18} stroke="var(--accent)"/>
            <span style={{ fontSize: 14 }}>Playlists</span>
          </button>
          <div style={{ flex: 1 }}/>
          <button onClick={() => setInfoSheet(true)} style={{ display: 'flex', padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0 }}>
            <Icons.info size={18} stroke="var(--text-2)"/>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, padding: '8px 22px 8px', alignItems: 'flex-end' }}>
          <MMArt src={artworkSrc} size={112} radius={14} glow/>
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', letterSpacing: -0.3, lineHeight: 1.15 }}>{name}</h1>
              <MMBadge label="SPOTIFY"/>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
              {promoted
                ? 'fully linked · promoted to a local playlist'
                : fullyLinked
                ? 'fully linked · can be promoted to a local playlist'
                : `${linkedCount} of ${rows.length} linked`}
            </div>
            {!promoted && externalCount > 0 && (
              <button
                onClick={() => { if (activeSpotifySource) downloadAllTracks(activeSpotifySource).catch(console.error); }}
                disabled={anyDownloading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
                  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-2)',
                  background: 'var(--bg-3)', color: 'var(--accent-light)',
                  fontSize: 12.5, fontWeight: 600, cursor: anyDownloading ? 'default' : 'pointer',
                  opacity: anyDownloading ? 0.6 : 1,
                }}
              >
                <Icons.download size={14}/>
                {anyDownloading ? 'Downloading…' : `Download All (${externalCount})`}
              </button>
            )}
            {!promoted && fullyLinked && (
              <button
                onClick={handlePromote}
                disabled={promoting}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
                  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--accent)',
                  background: 'var(--accent-dim)', color: 'var(--accent-light)',
                  fontSize: 12.5, fontWeight: 600, cursor: promoting ? 'default' : 'pointer',
                  opacity: promoting ? 0.6 : 1,
                }}
              >
                <Icons.upload size={14}/>
                {promoting ? 'Promoting…' : 'Promote to Playlist'}
              </button>
            )}
          </div>
        </div>

        {activeSpotifyLoading && (
          <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
            <MMLoader/>
          </div>
        )}
        {!activeSpotifyLoading && rows.length === 0 && (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14, fontStyle: 'italic' }}>
            No tracks in this playlist
          </div>
        )}

        <div style={{ padding: '8px 0' }}>
          {!activeSpotifyLoading && rows.map(row => {
            if (row.kind === 'local') {
              return (
                <SpotifyLocalRow
                  key={row.spotifyId}
                  track={row.track}
                  playing={loadedHash === row.track.hash}
                  onPlay={() => playTrack(row.track.hash)}
                  onLongPress={() => setRejectSheet({ spotifyId: row.spotifyId, hash: row.track.hash, label: row.track.title })}
                />
              );
            }
            if (row.kind === 'review') {
              return (
                <ReviewTrackRow
                  key={row.review.spotifyId}
                  review={row.review}
                  onKeep={() => resolveReviewTrack(row.review.spotifyId, 'keep')}
                  onDiscard={() => resolveReviewTrack(row.review.spotifyId, 'discard')}
                />
              );
            }
            return (
              <ExternalTrackRow
                key={row.record.spotify_id}
                track={row.record}
                downloading={downloadingSpotifyIds.includes(row.record.spotify_id)}
                onLongPress={() => setExternalSheet({ spotifyId: row.record.spotify_id, label: row.record.title })}
              />
            );
          })}
        </div>
      </div>

      <MiniPlayer onTab={onTab}/>
      <MMTabBar active="playlists" onTab={onTab}/>

      {externalSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setExternalSheet(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title="Spotify Track"
            subtitle={externalSheet.label}
            height="26%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setExternalSheet(null)}
          >
            <GetTrackSheet
              label={externalSheet.label}
              downloading={downloadingSpotifyIds.includes(externalSheet.spotifyId)}
              onGetTrack={() => { downloadAndLinkExternalTrack(externalSheet.spotifyId).catch(console.error); }}
              onClose={() => setExternalSheet(null)}
            />
          </MMSheet>
        </div>
      )}

      {infoSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setInfoSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title="What's a Spotify playlist here?"
            height="46%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setInfoSheet(false)}
          >
            <div style={{ padding: '4px 4px 12px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--text-1)' }}>
              <p style={{ margin: 0 }}>This is a live view of a Spotify playlist, not a real Melomaniac playlist yet — no commit history, branches, or sync until it's promoted.</p>
              <p style={{ margin: 0 }}>Tracks Melomaniac already has locally show up as normal rows. Anything else appears dashed with a "Get track" action — Melomaniac searches for and downloads it, then links it to the Spotify entry.</p>
              <p style={{ margin: 0 }}>If a download's length looks off from what Spotify reports, it's held for you to Keep or Discard instead of linking automatically.</p>
              <p style={{ margin: 0 }}>Once every track is linked, you can promote it into a real local playlist — with its name, artwork, and track order carried over. Promotion is manual, so you can also just download the tracks and skip it if you don't want a matching playlist entry.</p>
            </div>
          </MMSheet>
        </div>
      )}

      {rejectSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={() => setRejectSheet(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}/>
          <MMSheet
            title="Spotify Match"
            subtitle={rejectSheet.label}
            height="26%"
            animStyle={{ animation: 'mmSheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both' }}
            onClose={() => setRejectSheet(null)}
          >
            <button
              onClick={() => { rejectMatch(rejectSheet.spotifyId, rejectSheet.hash); setRejectSheet(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
              }}
            >
              <Icons.x size={17} stroke="var(--text-2)"/>
              <span style={{ fontSize: 15, color: 'var(--text-0)', fontWeight: 500 }}>Reject Spotify match</span>
            </button>
          </MMSheet>
        </div>
      )}
    </div>
  );
}
