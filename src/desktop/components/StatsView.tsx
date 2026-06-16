import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TrackRecord } from '../data';
import type { TrackStats } from '../../store/types';
import { IcoMetrics, IcoSync } from '../icons';
import { FiTrash2 } from 'react-icons/fi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const ROW_HEIGHT = 44;

// ── Component ─────────────────────────────────────────────────────────────────

export default function StatsView(): JSX.Element {
  const [rows, setRows] = useState<Array<{ hash: string; stats: TrackStats; track: TrackRecord | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    fetchedRef.current.clear();
    try {
      const [allStats, allTracks] = await Promise.all([
        invoke<[string, TrackStats][]>('library_get_all_track_stats'),
        invoke<TrackRecord[]>('library_get_all'),
      ]);

      const trackMap = new Map<string, TrackRecord>(allTracks.map(t => [t.hash, t]));
      const nextRows = allStats.map(([hash, stats]) => ({
        hash,
        stats,
        track: trackMap.get(hash) ?? null,
      }));
      setRows(nextRows);

      // Deduplicate by artwork_hash — one request per unique album art
      const seenArtwork = new Set<string>();
      for (const { hash, track } of nextRows) {
        if (!track?.artwork_hash || seenArtwork.has(track.artwork_hash)) continue;
        seenArtwork.add(track.artwork_hash);
        fetchedRef.current.add(hash);
        invoke<string>('track_get_artwork', { hash })
          .then(url => setArtworkUrls(prev => ({ ...prev, [hash]: url })))
          .catch(() => {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  // Build a hash→artworkUrl lookup that also covers tracks sharing artwork
  // with a loaded representative track.
  const artworkForHash = useCallback((hash: string, track: TrackRecord | null): string | null => {
    if (artworkUrls[hash]) return artworkUrls[hash];
    if (!track?.artwork_hash) return null;
    // Find any other loaded URL with the same artwork_hash
    const rep = rows.find(r => r.track?.artwork_hash === track.artwork_hash && artworkUrls[r.hash]);
    return rep ? artworkUrls[rep.hash] : null;
  }, [artworkUrls, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px 8px',
        borderBottom: '1px solid var(--border-0)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <IcoMetrics size={14} style={{ color: 'var(--text-2)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
          Listening Stats
        </span>
        <div style={{ flex: 1 }} />
        {confirmClear ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-1)' }}>Are you sure?</span>
            <button
              onClick={async () => {
                await invoke('library_clear_history');
                setConfirmClear(false);
                load();
              }}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #c0392b', background: '#c0392b22', color: '#e05050', cursor: 'pointer' }}
            >
              Clear
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-2)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
            title="Clear listening history"
          >
            <FiTrash2 size={13} />
          </button>
        )}
        <button
          onClick={load}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
          title="Refresh"
        >
          <IcoSync size={13} />
        </button>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr 80px 72px 90px',
        padding: '5px 16px',
        borderBottom: '1px solid var(--border-0)',
        flexShrink: 0,
        gap: 8,
      }}>
        {['#', 'Track', 'Plays', 'Skips', 'Listen time'].map(label => (
          <span key={label} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-2)',
          }}>{label}</span>
        ))}
      </div>

      {/* Virtualized rows */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 6 }}>No tracks in library</div>
            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>Add some playlists to get started.</div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vRow => {
              const { hash, stats, track } = rows[vRow.index];
              const artUrl = artworkForHash(hash, track);
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: 'absolute',
                    top: vRow.start,
                    left: 0,
                    width: '100%',
                    height: vRow.size,
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr 80px 72px 90px',
                    padding: '0 16px',
                    gap: 8,
                    alignItems: 'center',
                    borderBottom: '1px solid var(--border-0)',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Rank */}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {vRow.index + 1}
                  </span>

                  {/* Track — artwork + title/artist */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 4, flexShrink: 0,
                      background: 'var(--bg-3)', overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {artUrl
                        ? <img src={artUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 12, opacity: 0.3 }}>♪</span>
                      }
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 500, color: 'var(--text-0)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {track?.title ?? hash.slice(0, 12) + '…'}
                      </div>
                      {track?.artist && (
                        <div style={{
                          fontSize: 10, color: 'var(--text-2)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {track.artist}{track.album ? ` · ${track.album}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Plays */}
                  <span style={{ fontSize: 11, color: stats.play_count > 0 ? 'var(--accent-light)' : 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {stats.play_count > 0 ? `${stats.play_count} ${stats.play_count === 1 ? 'play' : 'plays'}` : '—'}
                  </span>

                  {/* Skips */}
                  <span style={{ fontSize: 11, color: stats.skip_count > 0 ? 'var(--text-1)' : 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {stats.skip_count > 0 ? `${stats.skip_count} ${stats.skip_count === 1 ? 'skip' : 'skips'}` : '—'}
                  </span>

                  {/* Listen time */}
                  <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {stats.total_listen_ms > 0 ? fmtDuration(stats.total_listen_ms) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
