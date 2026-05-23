import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IcoClose, IcoDownload } from '../icons';

// ── Types ─────────────────────────────────────────────────────────────────────

type DownloadStatus = 'queued' | 'downloading' | 'ingesting' | 'done' | 'failed';

interface DownloadJob {
  id:       string;
  url:      string;
  status:   DownloadStatus;
  progress: number;
  title:    string | null;
  error:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sourceFromUrl(url: string): { label: string; color: string } | null {
  if (!url) return null;
  if (/youtube\.com|youtu\.be/i.test(url))  return { label: 'YouTube',    color: '#ff4040' };
  if (/soundcloud\.com/i.test(url))         return { label: 'SoundCloud', color: '#f76e30' };
  if (/bandcamp\.com/i.test(url))           return { label: 'Bandcamp',   color: '#1da0c3' };
  if (/spotify\.com/i.test(url))            return { label: 'Spotify',    color: '#1db954' };
  if (/^https?:\/\//i.test(url))            return { label: 'URL',        color: 'var(--text-2)' };
  return null;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DownloadModal({ onClose }: Props) {
  const [queue, setQueue] = useState<DownloadJob[]>([]);
  const [url,   setUrl]   = useState('');

  const source = useMemo(() => sourceFromUrl(url.trim()), [url]);

  // Seed queue from backend on open (shows any in-progress downloads)
  useEffect(() => {
    invoke<DownloadJob[]>('download_queue').then(jobs => {
      if (jobs.length > 0) setQueue(jobs);
    });
  }, []);

  // Listen to download events
  useEffect(() => {
    const subs = [
      listen<{ id: string; pct: number; status: string; title: string | null }>('download://progress', ({ payload }) => {
        setQueue(q => q.map(j =>
          j.id === payload.id
            ? { ...j, progress: payload.pct, status: payload.status as DownloadStatus, title: payload.title ?? j.title }
            : j
        ));
      }),
      listen<{ id: string; track_hash: string; title: string }>('download://done', ({ payload }) => {
        setQueue(q => q.map(j =>
          j.id === payload.id ? { ...j, status: 'done', progress: 1, title: payload.title } : j
        ));
      }),
      listen<{ id: string; error: string }>('download://error', ({ payload }) => {
        setQueue(q => q.map(j =>
          j.id === payload.id ? { ...j, status: 'failed', error: payload.error } : j
        ));
      }),
    ];
    // listen() returns a Promise<UnlistenFn> — must resolve each before calling to unsubscribe
    return () => { subs.forEach(p => p.then(fn => fn())); };
  }, []);

  const enqueue = useCallback(async () => {
    const trimmed = url.trim();
    // Spotify is blocked: requires librespot bridge not yet implemented
    if (!trimmed || source?.label === 'Spotify') return;
    const id: string = await invoke('download_enqueue', { url: trimmed });
    setQueue(q => [...q, { id, url: trimmed, status: 'queued', progress: 0, title: null, error: null }]);
    setUrl('');
  }, [url, source]);

  const cancel = useCallback(async (id: string) => {
    await invoke('download_cancel', { id });
  }, []);

  const canDownload = url.trim().length > 0 && source?.label !== 'Spotify';
  const doneCount   = queue.filter(j => j.status === 'done').length;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 500, background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 10,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        maxHeight: '80vh',
      }}>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IcoDownload size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              Download
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={13} />
          </button>
        </div>

        {/* URL input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={LABEL_STYLE}>URL</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canDownload) enqueue(); }}
              placeholder="Paste a YouTube, SoundCloud, or Bandcamp URL…"
              autoFocus
              style={INPUT_STYLE}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-dim)'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            {source && (
              <span style={{
                padding: '5px 12px', borderRadius: 5, flexShrink: 0,
                background: 'var(--bg-4)', border: '1px solid var(--border-2)',
                fontSize: 12, color: source.color,
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
              }}>
                {source.label}
              </span>
            )}
          </div>

          {source?.label === 'Spotify' && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: '#1db954' }}>Spotify</span> requires the librespot bridge — coming soon.
            </p>
          )}
        </div>

        {/* Download button */}
        <button
          disabled={!canDownload}
          onClick={enqueue}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 20px', borderRadius: 6,
            background: 'var(--accent-dim)', border: '1px solid var(--accent)',
            color: 'var(--accent-light)', fontSize: 12, fontWeight: 600,
            cursor: canDownload ? 'pointer' : 'not-allowed',
            opacity: canDownload ? 1 : 0.4,
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          <IcoDownload size={13} /> Download
        </button>

        {/* Queue */}
        {queue.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>
              Queue — {doneCount}/{queue.length} done
            </div>
            {queue.map(job => (
              <QueueRow key={job.id} job={job} onCancel={() => cancel(job.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── QueueRow ──────────────────────────────────────────────────────────────────

function QueueRow({ job, onCancel }: { job: DownloadJob; onCancel: () => void }) {
  const STATUS_COLOR: Record<DownloadStatus, string> = {
    queued:      'var(--text-3)',
    downloading: 'var(--accent-light)',
    ingesting:   '#a78bfa',
    done:        '#4ade80',
    failed:      '#f87171',
  };
  const STATUS_LABEL: Record<DownloadStatus, string> = {
    queued:      'Queued',
    downloading: `${Math.round(job.progress * 100)}%`,
    ingesting:   'Ingesting…',
    done:        'Done',
    failed:      'Failed',
  };
  const active = job.status === 'queued' || job.status === 'downloading' || job.status === 'ingesting';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5,
      padding: '9px 12px', borderRadius: 6,
      background: 'var(--bg-2)', border: '1px solid var(--border-1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          flex: 1, fontSize: 12, color: 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: "'Outfit', sans-serif",
        }}>
          {job.title ?? job.url}
        </span>
        <span style={{ fontSize: 11, color: STATUS_COLOR[job.status], flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
          {STATUS_LABEL[job.status]}
        </span>
        {active && (
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '1px 4px', borderRadius: 3, fontSize: 12, lineHeight: 1 }}>
            ✕
          </button>
        )}
      </div>

      {(job.status === 'downloading' || job.status === 'ingesting') && (
        <div style={{ height: 3, background: 'var(--bg-5)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: job.status === 'ingesting' ? '#a78bfa' : 'var(--accent)',
            width: `${job.progress * 100}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <span style={{ fontSize: 10, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{job.error}</span>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  fontFamily: "'Outfit', sans-serif",
};

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  borderRadius: 5, color: 'var(--text-1)', fontSize: 12,
  padding: '7px 10px', outline: 'none',
  fontFamily: "'Outfit', sans-serif",
};
