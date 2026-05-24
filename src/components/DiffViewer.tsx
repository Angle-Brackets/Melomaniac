import { useState } from 'react'
import { useStore } from '../store'
import type { ConflictChunk, ConflictKind, ConflictResolution } from '../store/types'
import { useAnimatedMount } from '../desktop/hooks/useAnimatedMount'
import ScrollText from '../desktop/components/ScrollText'

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ColHeader({ label }: { label: string }) {
  return (
    <div className="text-xs font-mono font-bold tracking-widest uppercase opacity-60 mb-1">
      {label}
    </div>
  )
}

/** Resolve a BLAKE3 track hash to a human-readable label. */
function useTrackLabel(): (hash: string | undefined) => string {
  const tracks = useStore(s => s.tracks)
  return (hash) => {
    if (!hash) return '—'
    const t = tracks.find(tr => tr.hash === hash)
    if (t) return t.artist ? `${t.title} — ${t.artist}` : t.title
    return hash.slice(0, 12)
  }
}

function TrackOrderConflict({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice']) => void
}) {
  const ours      = Array.isArray(chunk.ours)   ? (chunk.ours   as string[]) : []
  const theirs    = Array.isArray(chunk.theirs) ? (chunk.theirs as string[]) : []
  const max       = Math.max(ours.length, theirs.length)
  const trackLabel = useTrackLabel()

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <ColHeader label="Your Version" />
          <div className="flex flex-col gap-0.5">
            {Array.from({ length: max }).map((_, i) => {
              const hash    = ours[i]
              const differs = hash !== theirs[i]
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono ${differs ? 'bg-amber-500/15 text-amber-300' : 'bg-base-200'}`}
                >
                  <span className="opacity-40 w-5 text-right shrink-0">{i + 1}</span>
                  <ScrollText text={trackLabel(hash)} style={{ flex: 1, minWidth: 0 }} />
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <ColHeader label="Their Version" />
          <div className="flex flex-col gap-0.5">
            {Array.from({ length: max }).map((_, i) => {
              const hash    = theirs[i]
              const differs = hash !== ours[i]
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono ${differs ? 'bg-amber-500/15 text-amber-300' : 'bg-base-200'}`}
                >
                  <span className="opacity-40 w-5 text-right shrink-0">{i + 1}</span>
                  <ScrollText text={trackLabel(hash)} style={{ flex: 1, minWidth: 0 }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepOurs')}>Keep Mine</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepTheirs')}>Keep Theirs</button>
      </div>
    </div>
  )
}

type AbPoints = { ab_a: number; ab_b: number }

function isAbPoints(v: unknown): v is AbPoints {
  return typeof v === 'object' && v !== null && 'ab_a' in v && 'ab_b' in v
}

function TrackDeletedConflict({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice']) => void
}) {
  const oursIsNull   = chunk.ours === null
  const theirsIsNull = chunk.theirs === null
  const trackLabel   = useTrackLabel()

  const ctxHash = typeof chunk.context === 'object' && chunk.context !== null && 'hash' in chunk.context
    ? String((chunk.context as Record<string, unknown>).hash)
    : undefined

  return (
    <div className="flex flex-col gap-4">
      {ctxHash && (
        <div className="text-xs font-mono opacity-60 truncate">
          Track: <span className="text-base-content">{trackLabel(ctxHash)}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <ColHeader label="Your Version" />
          <div className="rounded bg-base-200 p-3 text-sm">
            {oursIsNull
              ? <span className="text-error opacity-80">Deleted this track</span>
              : isAbPoints(chunk.ours)
                ? <span>Kept with A/B: {fmtMs(chunk.ours.ab_a)} – {fmtMs(chunk.ours.ab_b)}</span>
                : <span>Modified</span>
            }
          </div>
        </div>
        <div>
          <ColHeader label="Their Version" />
          <div className="rounded bg-base-200 p-3 text-sm">
            {theirsIsNull
              ? <span className="text-error opacity-80">Deleted this track</span>
              : isAbPoints(chunk.theirs)
                ? <span>Kept with A/B: {fmtMs(chunk.theirs.ab_a)} – {fmtMs(chunk.theirs.ab_b)}</span>
                : <span>Modified</span>
            }
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-sm btn-error flex-1" onClick={() => onChoice('Delete')}>Delete it</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepOurs')}>Keep with changes</button>
      </div>
    </div>
  )
}

function MetadataConflict({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice']) => void
}) {
  const oursStr   = typeof chunk.ours   === 'string' ? chunk.ours   : JSON.stringify(chunk.ours)
  const theirsStr = typeof chunk.theirs === 'string' ? chunk.theirs : JSON.stringify(chunk.theirs)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <ColHeader label="Your Version" />
          <div className="rounded bg-base-200 p-3 text-sm break-words">{oursStr || <em className="opacity-40">empty</em>}</div>
        </div>
        <div>
          <ColHeader label="Their Version" />
          <div className="rounded bg-base-200 p-3 text-sm break-words">{theirsStr || <em className="opacity-40">empty</em>}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepOurs')}>Keep Mine</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepTheirs')}>Keep Theirs</button>
      </div>
    </div>
  )
}

function BranchNameConflict({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice'], renameTo?: string) => void
}) {
  const name = typeof chunk.context === 'string' ? chunk.context : String(chunk.context ?? '')

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded bg-base-200 p-3 text-sm">
        Both sides have a branch named <span className="font-mono font-bold text-warning">"{name}"</span>
      </div>
      <div className="flex gap-2 mt-2 flex-wrap">
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepOurs')}>Rename Mine</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepTheirs')}>Rename Theirs</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepBoth')}>Keep Both (auto-rename)</button>
      </div>
    </div>
  )
}

function AbLoopConflict({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice']) => void
}) {
  const oursPoints   = isAbPoints(chunk.ours)   ? chunk.ours   : null
  const theirsPoints = isAbPoints(chunk.theirs) ? chunk.theirs : null
  const trackLabel   = useTrackLabel()

  const trackHash = typeof chunk.theirs === 'object' && chunk.theirs !== null && 'hash' in chunk.theirs
    ? String((chunk.theirs as Record<string, unknown>).hash)
    : typeof chunk.ours === 'object' && chunk.ours !== null && 'hash' in chunk.ours
      ? String((chunk.ours as Record<string, unknown>).hash)
      : undefined

  return (
    <div className="flex flex-col gap-4">
      {trackHash && (
        <div className="text-xs font-mono opacity-60 truncate">
          Track: <span className="text-base-content">{trackLabel(trackHash)}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <ColHeader label="Your Version" />
          <div className="rounded bg-base-200 p-3 text-sm font-mono">
            {oursPoints ? `A: ${fmtMs(oursPoints.ab_a)} / B: ${fmtMs(oursPoints.ab_b)}` : '—'}
          </div>
        </div>
        <div>
          <ColHeader label="Their Version" />
          <div className="rounded bg-base-200 p-3 text-sm font-mono">
            {theirsPoints ? `A: ${fmtMs(theirsPoints.ab_a)} / B: ${fmtMs(theirsPoints.ab_b)}` : '—'}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepOurs')}>Keep Mine</button>
        <button className="btn btn-sm flex-1" onClick={() => onChoice('KeepTheirs')}>Keep Theirs</button>
      </div>
    </div>
  )
}

function ConflictBody({
  chunk,
  onChoice,
}: {
  chunk: ConflictChunk
  onChoice: (choice: ConflictResolution['choice'], renameTo?: string) => void
}) {
  const kind: ConflictKind = chunk.kind
  if (kind === 'TrackOrder')             return <TrackOrderConflict   chunk={chunk} onChoice={onChoice} />
  if (kind === 'TrackDeletedVsModified') return <TrackDeletedConflict chunk={chunk} onChoice={onChoice} />
  if (kind === 'MetadataEdit')           return <MetadataConflict     chunk={chunk} onChoice={onChoice} />
  if (kind === 'BranchNameCollision')    return <BranchNameConflict   chunk={chunk} onChoice={onChoice} />
  if (kind === 'AbLoopPoints')           return <AbLoopConflict       chunk={chunk} onChoice={onChoice} />
  return <div className="text-sm opacity-60">Unknown conflict type: {kind}</div>
}

function DiffViewerInner({
  platform,
  closing,
}: {
  platform: 'desktop' | 'mobile'
  closing: boolean
}) {
  const conflicts        = useStore(s => s.mergeConflicts)
  const playlistId       = useStore(s => s.mergePlaylistId)
  const currentIdx       = useStore(s => s.currentChunkIdx)
  const closeDiffViewer  = useStore(s => s.closeDiffViewer)
  const submitResolution = useStore(s => s.submitResolution)
  const finalizeMerge    = useStore(s => s.finalizeMerge)
  const playlists        = useStore(s => s.playlists)

  const [finalizing, setFinalizing] = useState(false)

  const playlist     = playlists.find(p => p.id === playlistId)
  const total        = conflicts.length
  const chunk        = conflicts[currentIdx] ?? null
  const done         = currentIdx >= total
  const playlistName = playlist?.name ?? playlistId ?? 'playlist'

  const handleChoice = (choice: ConflictResolution['choice'], renameTo?: string) => {
    if (!chunk) return
    submitResolution({ conflict_id: chunk.id, choice, ...(renameTo ? { rename_to: renameTo } : {}) })
  }

  const handleFinalize = async () => {
    setFinalizing(true)
    try { await finalizeMerge() } finally { setFinalizing(false) }
  }

  const header = (
    <div className="flex items-center justify-between mb-4 gap-4">
      <div className="min-w-0">
        <div className="text-xs font-mono uppercase tracking-widest opacity-50 mb-0.5">Merge conflict</div>
        <div className="font-semibold text-sm flex items-baseline gap-2 min-w-0">
          <ScrollText text={`"${playlistName}"`} style={{ minWidth: 0 }} />
          {!done && total > 0 && (
            <span className="shrink-0 opacity-50 font-normal text-xs">{currentIdx + 1} of {total}</span>
          )}
        </div>
      </div>
      <button
        onClick={closeDiffViewer}
        className="btn btn-ghost btn-xs opacity-60 hover:opacity-100 shrink-0"
      >
        Dismiss
      </button>
    </div>
  )

  const body = done ? (
    <div className="flex flex-col gap-4">
      <div className="text-sm opacity-70">All {total} conflict{total !== 1 ? 's' : ''} resolved.</div>
      <button
        className="btn btn-primary btn-sm"
        onClick={handleFinalize}
        disabled={finalizing}
      >
        {finalizing ? 'Committing…' : 'Create Merge Commit'}
      </button>
    </div>
  ) : chunk ? (
    <div>
      <div className="text-xs font-mono uppercase tracking-widest opacity-40 mb-3">{chunk.kind}</div>
      <ConflictBody chunk={chunk} onChoice={handleChoice} />
    </div>
  ) : null

  if (platform === 'mobile') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div
          className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${closing ? 'mm-backdrop-exit' : 'mm-backdrop'}`}
          onClick={closeDiffViewer}
        />
        <div
          className={`relative bg-base-100 rounded-t-2xl p-5 pb-safe ${closing ? 'mm-sheet-exit' : 'mm-sheet'}`}
          style={{ maxHeight: '85vh', overflowY: 'auto' }}
        >
          <div className="flex justify-center mb-3">
            <div className="w-9 h-1 rounded-full bg-base-content/20" />
          </div>
          {header}
          {body}
        </div>
      </div>
    )
  }

  // Desktop: centered modal with enter/exit animation
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${closing ? 'mm-backdrop-exit' : 'mm-backdrop'}`}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeDiffViewer}
      />
      <div
        className={`relative bg-base-100 rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 flex flex-col ${closing ? 'mm-modal-box-exit' : 'mm-modal-box'}`}
        style={{ maxHeight: '82vh' }}
      >
        {header}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

export function DiffViewer({ platform }: { platform: 'desktop' | 'mobile' }) {
  const open = useStore(s => s.diffViewerOpen)
  const { mounted, closing } = useAnimatedMount(open)
  if (!mounted) return null
  return <DiffViewerInner platform={platform} closing={closing} />
}
