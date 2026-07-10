import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { TooltipContentProps } from 'recharts';

export interface ChartSeries {
  hash:  string;
  label: string;
  color: string;
}

export interface ChartBucket {
  label: string;
  [hash: string]: number | string;
}

function fmtMinutes(ms: number): string {
  const mins = ms / 60_000;
  if (mins < 1) return `${Math.round(ms / 1000)}s`;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

// Tooltips render with pointer-events disabled, so an overflow scrollbar is
// unusable — cap the list instead and summarize the rest.
const TOOLTIP_MAX_ROWS = 8;

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const shown = sorted.slice(0, TOOLTIP_MAX_ROWS);
  const hiddenCount = sorted.length - shown.length;
  return (
    <div style={{
      background: 'var(--bg-3)',
      border: '1px solid var(--border-1)',
      borderRadius: 6,
      padding: '8px 10px',
      minWidth: 140,
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {shown.map(entry => (
        <div key={entry.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{
            flex: 1, fontSize: 11, color: 'var(--text-1)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140,
          }}>
            {entry.name}
          </span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-0)' }}>
            {fmtMinutes(Number(entry.value) || 0)}
          </span>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '3px 0 0', fontStyle: 'italic' }}>
          +{hiddenCount} more track{hiddenCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

interface ListenStatsChartProps {
  series:  ChartSeries[];
  buckets: ChartBucket[];
}

const CHART_HEIGHT = 340;

// Safe-ish DOM id fragment: hashes are hex strings, but strip anything that
// isn't id-safe just in case a track's hash-like key ever isn't.
function gradientId(hash: string): string {
  return `listen-fill-${hash.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export default function ListenStatsChart({ series, buckets }: ListenStatsChartProps): JSX.Element {
  if (series.length === 0) {
    return (
      <div style={{
        height: CHART_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: 11,
      }}>
        Toggle a track's swatch below to see its listening trend.
      </div>
    );
  }

  return (
    <div style={{ height: CHART_HEIGHT, padding: '16px 20px 8px 8px', position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 2, top: '50%',
        transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center',
        fontSize: 11, fontWeight: 600, color: '#ffffff', letterSpacing: '0.04em',
        whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>
        Listen time
      </div>
      <div style={{ height: '100%', paddingLeft: 22 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={buckets} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <defs>
              {/* Smooth top-to-bottom fade per series instead of a flat fill — reads as
                  "glow" against the dark background without any blur filter. */}
              {series.map(s => (
                <linearGradient key={s.hash} id={gradientId(s.hash)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={s.color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#ffffff' }}
              axisLine={{ stroke: 'var(--border-1)' }}
              tickLine={false}
              tickMargin={10}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={v => fmtMinutes(v)}
              tick={{ fontSize: 12, fill: '#ffffff' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={56}
            />
            <Tooltip content={ChartTooltip} isAnimationActive={false} wrapperStyle={{ zIndex: 40 }} />
            {series.map(s => (
              <Area
                key={s.hash}
                type="monotone"
                dataKey={s.hash}
                name={s.label}
                stackId="1"
                stroke={s.color}
                fill={`url(#${gradientId(s.hash)})`}
                fillOpacity={1}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
