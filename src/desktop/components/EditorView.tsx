import { ALBUMS } from '../data';
import type { Track } from '../data';
import { IcoEditor } from '../icons';

export default function EditorView({ track }: { track?: Track }) {
  const albumGradient = track ? (ALBUMS[track.albumRef]?.gradient ?? ALBUMS[0].gradient) : 'var(--bg-4)';

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-mm-2 gap-3.5">
      <div className="w-14 h-14 rounded-xl shrink-0"
        style={{ background: albumGradient, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
      />
      <div className="text-center">
        <div className="text-sm font-bold text-mm-t0 mb-1">
          {track ? track.title : 'No track selected'}
        </div>
        {track && (
          <div className="text-[11px] text-mm-t2 mb-4">
            {track.artist} · {track.album}
          </div>
        )}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-mm-b2 bg-mm-3">
          <IcoEditor size={14} className="text-mm-accent" />
          <span className="text-[13px] font-semibold text-mm-accent-lit font-mono">Unimplemented!</span>
        </div>
        <div className="text-[10px] text-mm-t2 mt-2.5 font-mono">
          MP3 metadata editor · coming soon
        </div>
      </div>
    </div>
  );
}
