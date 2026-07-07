import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IcoClose } from '../icons';
import { FiAlertTriangle } from 'react-icons/fi';

interface GcReport { blobs_removed: number; bytes_freed: number }
interface BlobInfo { hash: string; size_bytes: number; reachable: boolean; title: string | null; artist: string | null }
interface BlobReference { playlist_name: string; branch_name: string }

function fmtBytes(b: number): string {
  if (b < 1024)      return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  onClose: () => void;
}

// Two tools for reclaiming disk space:
//  1. "Clean up unused audio" — safe, routine GC. Only removes audio no
//     playlist's commit history (past or present) still references.
//  2. "Find a specific file" — an escape hatch for a blob GC will never touch
//     because some playlist's history still points to it (e.g. a bad
//     download that got committed before you noticed it was wrong). Purging
//     one of these breaks reverting to any historical commit that used it.
export default function ManageStorageModal({ onClose }: Props) {
  const [gcPreview,    setGcPreview]    = useState<GcReport | null>(null);
  const [gcDone,       setGcDone]       = useState<GcReport | null>(null);
  const [gcScanning,   setGcScanning]   = useState(false);
  const [gcCollecting, setGcCollecting] = useState(false);

  const runGcScan = async () => {
    setGcScanning(true);
    try { setGcPreview(await invoke<GcReport>('storage_gc_scan')); }
    finally { setGcScanning(false); }
  };

  const runGcCollect = async () => {
    setGcCollecting(true);
    try { setGcDone(await invoke<GcReport>('storage_gc_collect')); setGcPreview(null); }
    finally { setGcCollecting(false); }
  };

  const [showLargest,    setShowLargest]    = useState(false);
  const [largestBlobs,   setLargestBlobs]   = useState<BlobInfo[] | null>(null);
  const [loadingLargest, setLoadingLargest] = useState(false);
  const [purgeTarget,    setPurgeTarget]     = useState<BlobInfo | null>(null);
  const [purgeRefs,      setPurgeRefs]       = useState<BlobReference[] | null>(null);
  const [loadingRefs,    setLoadingRefs]     = useState(false);
  const [purging,        setPurging]         = useState(false);

  const loadLargestBlobs = async () => {
    setLoadingLargest(true);
    try { setLargestBlobs(await invoke<BlobInfo[]>('storage_gc_largest_blobs', { limit: 25 })); }
    finally { setLoadingLargest(false); }
  };

  const toggleLargest = () => {
    const next = !showLargest;
    setShowLargest(next);
    if (next && !largestBlobs) loadLargestBlobs();
  };

  const openPurgeConfirm = async (blob: BlobInfo) => {
    setPurgeTarget(blob);
    setPurgeRefs(null);
    setLoadingRefs(true);
    try { setPurgeRefs(await invoke<BlobReference[]>('storage_gc_find_references', { hash: blob.hash })); }
    finally { setLoadingRefs(false); }
  };

  const confirmPurge = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      await invoke('storage_force_purge_blob', { hash: purgeTarget.hash });
      setLargestBlobs(blobs => blobs?.filter(b => b.hash !== purgeTarget.hash) ?? null);
      setPurgeTarget(null);
      setPurgeRefs(null);
      setGcPreview(null);
      setGcDone(null);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 460, maxHeight: '80vh', background: 'var(--bg-3)',
        border: '1px solid var(--border-2)', borderRadius: 10,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
            Manage Storage
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2 }}>
            <IcoClose size={13} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 7, background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Clean up unused audio</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
              {gcDone
                ? `Freed ${fmtBytes(gcDone.bytes_freed)} across ${gcDone.blobs_removed} file${gcDone.blobs_removed !== 1 ? 's' : ''}`
                : gcPreview
                  ? gcPreview.blobs_removed > 0
                    ? `${gcPreview.blobs_removed} unused file${gcPreview.blobs_removed !== 1 ? 's' : ''} found · ${fmtBytes(gcPreview.bytes_freed)}`
                    : 'Nothing to clean up'
                  : 'Finds audio no longer used by your library or any playlist’s history'}
            </span>
            <div>
              {gcDone || (gcPreview && gcPreview.blobs_removed === 0) ? (
                <button onClick={() => { setGcPreview(null); setGcDone(null); }} style={BTN_GHOST}>Rescan</button>
              ) : gcPreview ? (
                <button onClick={runGcCollect} disabled={gcCollecting} style={{ ...BTN_PRIMARY, opacity: gcCollecting ? 0.6 : 1 }}>
                  {gcCollecting ? 'Freeing…' : `Free up ${fmtBytes(gcPreview.bytes_freed)}`}
                </button>
              ) : (
                <button onClick={runGcScan} disabled={gcScanning} style={{ ...BTN_GHOST, opacity: gcScanning ? 0.6 : 1 }}>
                  {gcScanning ? 'Scanning…' : 'Scan'}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 7, background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Find a specific file</span>
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4, marginTop: 2 }}>
                  For a bad download stuck in a playlist's history — "clean up" above won't touch it
                </div>
              </div>
              <button onClick={toggleLargest} disabled={loadingLargest} style={{ ...BTN_GHOST, flexShrink: 0 }}>
                {loadingLargest ? 'Loading…' : showLargest ? 'Hide' : 'Show largest files'}
              </button>
            </div>

            {showLargest && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {largestBlobs && largestBlobs.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', padding: '8px 0' }}>No files found</span>
                )}
                {largestBlobs?.map(blob => (
                  <div key={blob.hash} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-1)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {blob.title ?? `${blob.hash.slice(0, 12)}…`}
                        {blob.artist ? ` — ${blob.artist}` : ''}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                        {fmtBytes(blob.size_bytes)}
                        {blob.reachable ? ' · kept alive by playlist history' : ' · already reclaimable via "clean up" above'}
                      </div>
                    </div>
                    <button onClick={() => openPurgeConfirm(blob)} style={{ ...BTN_GHOST, color: '#f87171', flexShrink: 0 }}>
                      Force delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {purgeTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setPurgeTarget(null); setPurgeRefs(null); } }}
        >
          <div style={{ width: 380, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              Permanently delete this file?
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {purgeTarget.title ?? purgeTarget.hash} ({fmtBytes(purgeTarget.size_bytes)}) will be deleted from disk immediately.
              This bypasses the usual safety check — it cannot be undone.
            </span>

            {loadingRefs ? (
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>Checking playlist history…</span>
            ) : purgeRefs && purgeRefs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border-1)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <FiAlertTriangle size={13} style={{ color: '#f0b04a', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, color: 'var(--text-1)' }}>Still referenced by history in:</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {purgeRefs.map((r, i) => <li key={i}>{r.playlist_name} / {r.branch_name}</li>)}
                </ul>
                <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4 }}>
                  If it's still showing in any of these playlists right now, it'll be auto-removed from them immediately.
                  Reverting to a past commit that used it will just show it as missing, the same way.
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No playlist history currently references this file.</span>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setPurgeTarget(null); setPurgeRefs(null); }} style={BTN_GHOST}>Cancel</button>
              <button
                onClick={confirmPurge}
                disabled={purging || loadingRefs}
                style={{ ...BTN_DANGER, opacity: (purging || loadingRefs) ? 0.5 : 1, cursor: (purging || loadingRefs) ? 'not-allowed' : 'pointer' }}
              >
                {purging ? 'Deleting…' : 'Yes, permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const BTN_GHOST: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 5, fontSize: 11.5, cursor: 'pointer',
  background: 'var(--bg-2)', border: '1px solid var(--border-1)',
  color: 'var(--text-2)', fontFamily: "'Outfit', sans-serif",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 5, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  background: 'var(--accent)', border: '1px solid var(--accent)',
  color: '#fff', fontFamily: "'Outfit', sans-serif",
};

const BTN_DANGER: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 5, fontSize: 12, fontWeight: 600,
  background: '#7f1d1d', border: '1px solid #f87171',
  color: '#fca5a5', fontFamily: "'Outfit', sans-serif",
};
