import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DesktopLoader from './DesktopLoader';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TrackRecord } from '../data';
import type { TrackStats, DailyTrackStat } from '../../store/types';
import { IcoMetrics, IcoSync } from '../icons';
import { FiTrash2, FiCalendar, FiCheck } from 'react-icons/fi';
import { extractAccents } from '../../shared/artworkAccents';
import ListenStatsChart, { type ChartSeries, type ChartBucket } from './ListenStatsChart';

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

type TimeframeKey = 'last7' | 'last30' | 'year' | 'all' | 'custom';

const TIMEFRAME_OPTIONS: { key: TimeframeKey; label: string }[] = [
  { key: 'last7',  label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'year',   label: 'This Year' },
  { key: 'all',    label: 'All Time' },
  { key: 'custom', label: 'Custom range' },
];

function computeRange(
  timeframe: TimeframeKey,
  customStart: string,
  customEnd: string,
): { start: number | null; end: number | null } {
  const now = Math.floor(Date.now() / 1000);
  switch (timeframe) {
    case 'last7':  return { start: now - 7  * 86_400, end: now };
    case 'last30': return { start: now - 30 * 86_400, end: now };
    case 'year': {
      const startOfYear = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
      return { start: startOfYear, end: now };
    }
    case 'all': return { start: null, end: null };
    case 'custom': {
      const start = customStart ? Math.floor(new Date(`${customStart}T00:00:00`).getTime() / 1000) : null;
      const end   = customEnd   ? Math.floor(new Date(`${customEnd}T23:59:59`).getTime() / 1000)   : null;
      return { start, end };
    }
  }
}

// Buckets to the Monday of the ISO week containing `date` ("YYYY-MM-DD").
function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow);
  return toDateKey(d);
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ROW_HEIGHT = 44;
const DEFAULT_VISIBLE_COUNT = 5;
// Above this span, bucket the chart by week instead of day — otherwise
// "This Year" / "All Time" render an unreadable 300+-point axis.
const WEEK_BUCKET_THRESHOLD_DAYS = 60;

// ── Timeframe selector ───────────────────────────────────────────────────────

function TimeframeSelector({
  timeframe, customStart, customEnd, onChangeTimeframe, onChangeCustomRange,
}: {
  timeframe:            TimeframeKey;
  customStart:          string;
  customEnd:            string;
  onChangeTimeframe:    (key: TimeframeKey) => void;
  onChangeCustomRange:  (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeLabel = TIMEFRAME_OPTIONS.find(o => o.key === timeframe)?.label ?? 'All Time';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'var(--bg-3)', border: '1px solid var(--border-1)',
          borderRadius: 4, padding: '3px 8px',
          fontSize: 10, color: 'var(--text-1)',
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
        }}
      >
        <FiCalendar size={10} />
        {activeLabel}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: 'var(--bg-3)', border: '1px solid var(--border-1)',
          borderRadius: 6, padding: 5, zIndex: 20, minWidth: 150,
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        }}>
          {TIMEFRAME_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => { onChangeTimeframe(o.key); if (o.key !== 'custom') setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 8px', borderRadius: 4, border: 'none', marginBottom: 1,
                background: timeframe === o.key ? 'var(--bg-1)' : 'none',
                color: timeframe === o.key ? 'var(--accent-light)' : 'var(--text-1)',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          ))}
          {timeframe === 'custom' && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 5,
              padding: '6px 6px 2px', borderTop: '1px solid var(--border-0)', marginTop: 4,
            }}>
              <input
                type="date" value={customStart}
                onChange={e => onChangeCustomRange(e.target.value, customEnd)}
                style={{ fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'var(--bg-2)', color: 'var(--text-0)' }}
              />
              <input
                type="date" value={customEnd}
                onChange={e => onChangeCustomRange(customStart, e.target.value)}
                style={{ fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'var(--bg-2)', color: 'var(--text-0)' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline Plays/Skips bar ───────────────────────────────────────────────────

function StatBar({ value, max, color, unit }: { value: number; max: number; color: string; unit: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center', overflow: 'hidden', borderRadius: 3 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`,
        background: color, opacity: 0.2,
      }} />
      <span style={{
        position: 'relative', fontSize: 11, padding: '0 5px',
        color: value > 0 ? 'var(--text-1)' : 'var(--text-3)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {value > 0 ? `${value} ${unit}${value === 1 ? '' : 's'}` : '—'}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StatsView(): JSX.Element {
  const [rows, setRows] = useState<Array<{ hash: string; stats: TrackStats; track: TrackRecord | null }>>([]);
  const [dailyStats, setDailyStats] = useState<DailyTrackStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const [accentColors, setAccentColors] = useState<Record<string, string>>({});
  const [visibleHashes, setVisibleHashes] = useState<Set<string>>(new Set());
  const [timeframe, setTimeframe] = useState<TimeframeKey>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [cumulative, setCumulative] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentRange = useMemo(
    () => computeRange(timeframe, customStart, customEnd),
    [timeframe, customStart, customEnd],
  );

  const load = useCallback(async (range: { start: number | null; end: number | null }) => {
    setLoading(true);
    fetchedRef.current.clear();
    try {
      const [[daily, skips], allTracks] = await Promise.all([
        invoke<[DailyTrackStat[], [string, number][]]>('library_get_listen_stats_range', {
          startTs: range.start, endTs: range.end,
        }),
        invoke<TrackRecord[]>('library_get_all'),
      ]);

      setDailyStats(daily);
      const skipMap = new Map(skips);

      const totals = new Map<string, { play_count: number; listen_ms: number }>();
      for (const d of daily) {
        const cur = totals.get(d.hash) ?? { play_count: 0, listen_ms: 0 };
        cur.play_count += d.play_count;
        cur.listen_ms  += d.listen_ms;
        totals.set(d.hash, cur);
      }

      const trackMap = new Map<string, TrackRecord>(allTracks.map(t => [t.hash, t]));
      const hashes = new Set<string>([...totals.keys(), ...skipMap.keys()]);
      const nextRows = [...hashes]
        .map(hash => {
          const t = totals.get(hash) ?? { play_count: 0, listen_ms: 0 };
          return {
            hash,
            stats: { play_count: t.play_count, skip_count: skipMap.get(hash) ?? 0, total_listen_ms: t.listen_ms },
            track: trackMap.get(hash) ?? null,
          };
        })
        .sort((a, b) => b.stats.play_count - a.stats.play_count || b.stats.skip_count - a.stats.skip_count);

      setRows(nextRows);
      // Preserve the user's selection across timeframe swaps — only fall back
      // to the top-5 default on the very first load, or if none of the
      // previously-selected tracks have any activity in the new range.
      const nextHashSet = new Set(nextRows.map(r => r.hash));
      setVisibleHashes(prev => {
        if (prev.size === 0) return new Set(nextRows.slice(0, DEFAULT_VISIBLE_COUNT).map(r => r.hash));
        const preserved = new Set([...prev].filter(h => nextHashSet.has(h)));
        return preserved.size > 0 ? preserved : new Set(nextRows.slice(0, DEFAULT_VISIBLE_COUNT).map(r => r.hash));
      });
      setAccentColors({});

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

  useEffect(() => {
    if (timeframe === 'custom' && (!customStart || !customEnd)) return;
    load(currentRange);
  }, [timeframe, customStart, customEnd, currentRange, load]);

  // Build a hash→artworkUrl lookup that also covers tracks sharing artwork
  // with a loaded representative track.
  const artworkForHash = useCallback((hash: string, track: TrackRecord | null): string | null => {
    if (artworkUrls[hash]) return artworkUrls[hash];
    if (!track?.artwork_hash) return null;
    const rep = rows.find(r => r.track?.artwork_hash === track.artwork_hash && artworkUrls[r.hash]);
    return rep ? artworkUrls[rep.hash] : null;
  }, [artworkUrls, rows]);

  // Resolve an accent color for every row (not just checked ones) as soon as
  // its artwork is known — the single source of truth shared by the table
  // swatch and the chart's series color. `extractAccents` dedupes/caches by
  // URL, so this is cheap even though it runs for the whole table.
  useEffect(() => {
    for (const { hash, track } of rows) {
      if (accentColors[hash]) continue;
      const url = artworkForHash(hash, track);
      if (!url) continue;
      extractAccents(url).then(([primary]) => {
        setAccentColors(prev => (prev[hash] ? prev : { ...prev, [hash]: primary }));
      }).catch(() => {});
    }
  }, [rows, artworkForHash, accentColors]);

  const toggleVisible = (hash: string) => {
    setVisibleHashes(prev => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  };

  const allVisible = rows.length > 0 && visibleHashes.size === rows.length;
  const toggleAllVisible = () => {
    setVisibleHashes(allVisible ? new Set() : new Set(rows.map(r => r.hash)));
  };

  const maxPlay = useMemo(() => Math.max(1, ...rows.map(r => r.stats.play_count)), [rows]);
  const maxSkip = useMemo(() => Math.max(1, ...rows.map(r => r.stats.skip_count)), [rows]);

  const { series: chartSeries, buckets: chartBuckets } = useMemo((): { series: ChartSeries[]; buckets: ChartBucket[] } => {
    if (visibleHashes.size === 0 || dailyStats.length === 0) return { series: [], buckets: [] };

    const sortedDates = [...dailyStats].map(d => d.date).sort();
    const spanDays = sortedDates.length > 1
      ? (new Date(`${sortedDates[sortedDates.length - 1]}T00:00:00`).getTime() - new Date(`${sortedDates[0]}T00:00:00`).getTime()) / 86_400_000
      : 0;
    const useWeeks = spanDays > WEEK_BUCKET_THRESHOLD_DAYS;

    const bucketKey = (date: string) => useWeeks ? isoWeekKey(date) : date;
    const bucketLabel = (key: string) => {
      const d = new Date(`${key}T00:00:00`);
      const short = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return useWeeks ? `Wk of ${short}` : short;
    };

    const bucketMap = new Map<string, ChartBucket>();
    for (const d of dailyStats) {
      if (!visibleHashes.has(d.hash)) continue;
      const key = bucketKey(d.date);
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = { label: bucketLabel(key) };
        bucketMap.set(key, bucket);
      }
      bucket[d.hash] = (Number(bucket[d.hash]) || 0) + d.listen_ms;
    }
    for (const bucket of bucketMap.values()) {
      for (const hash of visibleHashes) {
        if (!(hash in bucket)) bucket[hash] = 0;
      }
    }

    const buckets = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => b);

    if (cumulative) {
      const running: Record<string, number> = {};
      for (const hash of visibleHashes) running[hash] = 0;
      for (const bucket of buckets) {
        for (const hash of visibleHashes) {
          running[hash] += Number(bucket[hash]) || 0;
          bucket[hash] = running[hash];
        }
      }
    }

    const series: ChartSeries[] = rows
      .filter(r => visibleHashes.has(r.hash))
      .map(r => ({
        hash:  r.hash,
        label: r.track?.title ?? `${r.hash.slice(0, 10)}…`,
        color: accentColors[r.hash] ?? 'var(--accent)',
      }));

    return { series, buckets };
  }, [dailyStats, visibleHashes, rows, accentColors, cumulative]);

  const artworkForRow = useCallback((hash: string, track: TrackRecord | null): string | null =>
    artworkForHash(hash, track), [artworkForHash]);

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
        <div style={{
          display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--border-1)',
          borderRadius: 4, overflow: 'hidden',
        }}>
          {(['daily', 'cumulative'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setCumulative(mode === 'cumulative')}
              style={{
                fontSize: 10, padding: '3px 8px', border: 'none', cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                background: cumulative === (mode === 'cumulative') ? 'var(--bg-1)' : 'transparent',
                color: cumulative === (mode === 'cumulative') ? 'var(--accent-light)' : 'var(--text-1)',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
        <TimeframeSelector
          timeframe={timeframe}
          customStart={customStart}
          customEnd={customEnd}
          onChangeTimeframe={setTimeframe}
          onChangeCustomRange={(start, end) => { setCustomStart(start); setCustomEnd(end); }}
        />
        {confirmClear ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-1)' }}>Are you sure?</span>
            <button
              onClick={async () => {
                await invoke('library_clear_history');
                setConfirmClear(false);
                load(currentRange);
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
          onClick={() => load(currentRange)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
          title="Refresh"
        >
          <IcoSync size={13} />
        </button>
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-0)', flexShrink: 0 }}>
          <ListenStatsChart series={chartSeries} buckets={chartBuckets} />
        </div>
      )}

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr 100px 100px 90px',
        padding: '5px 16px',
        borderBottom: '1px solid var(--border-0)',
        flexShrink: 0,
        gap: 8,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-2)',
        }}>#</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button
            onClick={toggleAllVisible}
            title={allVisible ? 'Hide all from chart' : 'Show all in chart'}
            style={{
              width: 14, height: 14, borderRadius: 4, flexShrink: 0,
              border: `1px solid ${allVisible ? 'var(--accent)' : 'var(--border-2)'}`,
              padding: 0, cursor: 'pointer',
              background: allVisible ? 'var(--accent)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--bg-1)',
            }}
          >
            {allVisible && <FiCheck size={10} strokeWidth={3} />}
          </button>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-2)',
          }}>Track</span>
        </div>
        {['Plays', 'Skips', 'Listen time'].map(label => (
          <span key={label} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-2)',
          }}>{label}</span>
        ))}
      </div>

      {/* Virtualized rows */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }} className="styled-scroll">
        {loading && <DesktopLoader />}

        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 6 }}>No listening activity yet</div>
            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>Play some tracks, or try a wider timeframe.</div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vRow => {
              const { hash, stats, track } = rows[vRow.index];
              const artUrl = artworkForRow(hash, track);
              const isVisible = visibleHashes.has(hash);
              const trackColor = accentColors[hash] ?? 'var(--accent)';
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
                    gridTemplateColumns: '28px 1fr 100px 100px 90px',
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

                  {/* Track — toggleable color swatch + artwork + title/artist */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button
                      onClick={() => toggleVisible(hash)}
                      title={isVisible ? 'Hide from chart' : 'Show in chart'}
                      style={{
                        width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                        border: 'none', padding: 0, cursor: 'pointer',
                        background: trackColor,
                        opacity: isVisible ? 1 : 0.28,
                        boxShadow: isVisible ? `0 0 6px ${trackColor}` : 'none',
                        transition: 'opacity 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.15)')}
                      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                    />
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
                  <StatBar value={stats.play_count} max={maxPlay} color="var(--accent-light)" unit="play" />

                  {/* Skips */}
                  <StatBar value={stats.skip_count} max={maxSkip} color="var(--text-1)" unit="skip" />

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
