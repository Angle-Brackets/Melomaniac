import { ALBUMS } from '../data';
import type { Track } from '../data';

export default function EditorView({ track }: { track?: Track }) {
  const albumGradient = track ? (ALBUMS[track.albumRef]?.gradient ?? ALBUMS[0].gradient) : 'var(--bg-4)';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-2)', gap: 14,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 12,
        background: albumGradient,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        flexShrink: 0,
      }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', marginBottom: 4 }}>
          {track ? track.title : 'No track selected'}
        </div>
        {track && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 16 }}>
            {track.artist} · {track.album}
          </div>
        )}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 18px', borderRadius: 8,
          border: '1px dashed var(--border-2)',
          background: 'var(--bg-3)',
        }}>
          <svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 2l2.5 2.5L4 11H1.5v-2.5L8.5 2z"/>
            <path d="M7 3.5l2.5 2.5"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>
            Unimplemented!
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 10, fontFamily: "'JetBrains Mono', monospace" }}>
          MP3 metadata editor · coming soon
        </div>
      </div>
    </div>
  );
}
