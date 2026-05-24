import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { TrackRecord } from '../data';
import type { TrackStats } from '../../store/types';
import { IcoMetrics } from '../icons';

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

// ── Component ─────────────────────────────────────────────────────────────────

const TOP_LIMIT = 20;

export default function StatsView(): JSX.Element {
  const [rows, setRows] = useState<Array<{ hash: string; stats: TrackStats; track: TrackRecord | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    fetchedRef.current.clear();
    try {
      const [topPairs, allTracks] = await Promise.all([
        invoke<[string, TrackStats][]>('library_get_top_tracks', { limit: TOP_LIMIT }),
        invoke<TrackRecord[]>('library_get_all'),
      ]);

      const trackMap = new Map<string, TrackRecord>(allTracks.map(t => [t.hash, t]));
      const nextRows = topPairs.map(([hash, stats]) => ({
        hash,
        stats,
        track: trackMap.get(hash) ?? null,
      }));
      setRows(nextRows);

      // Fetch artwork for each track that has an artwork_hash, fire-and-forget per track
      for (const { hash, track } of nextRows) {
        if (!track?.artwork_hash || fetchedRef.current.has(hash)) continue;
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
        <button
          onClick={load}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-2)', fontSize: 10, padding: '2px 6px',
            borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
          title="Refresh"
        >
          Refresh
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

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 6 }}>No plays recorded yet</div>
            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>Start listening and your stats will appear here.</div>
          </div>
        )}

        {!loading && rows.map(({ hash, stats, track }, idx) => (
          <div
            key={hash}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 80px 72px 90px',
              padding: '6px 16px',
              gap: 8,
              borderBottom: '1px solid var(--border-0)',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Rank */}
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
              {idx + 1}
            </span>

            {/* Track info — artwork thumbnail + title/artist */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                background: 'var(--bg-3)',
                overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {artworkUrls[hash]
                  ? <img src={artworkUrls[hash]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 14, opacity: 0.3 }}>♪</span>
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
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Play count */}
            <span style={{
              fontSize: 11, color: 'var(--accent-light)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {stats.play_count} {stats.play_count === 1 ? 'play' : 'plays'}
            </span>

            {/* Skip count */}
            <span style={{
              fontSize: 11,
              color: stats.skip_count > 0 ? 'var(--text-1)' : 'var(--text-3)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {stats.skip_count > 0 ? `${stats.skip_count} skip${stats.skip_count === 1 ? '' : 's'}` : '—'}
            </span>

            {/* Listen time */}
            <span style={{
              fontSize: 11, color: 'var(--text-2)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {stats.total_listen_ms > 0 ? fmtDuration(stats.total_listen_ms) : '—'}
            </span>
          </div>
        ))}
      </div>

      {!loading && rows.length > 0 && (
        <div style={{
          padding: '6px 16px',
          borderTop: '1px solid var(--border-0)',
          fontSize: 10, color: 'var(--text-3)',
          flexShrink: 0,
        }}>
          Showing top {rows.length} of your most-played tracks
        </div>
      )}
    </div>
  );
}
