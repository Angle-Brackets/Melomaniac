import { useStore } from '../store'
import type { PlaylistManifest } from '../store/types'
import { HiCloudDownload } from 'react-icons/hi'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function ArtworkThumb({ hash, peerAddr, faded }: { hash: string; peerAddr: string; faded: boolean }) {
  return (
    <img
      src={`http://${peerAddr}/blob/${hash}`}
      className={`w-10 h-10 rounded object-cover shrink-0 ${faded ? 'opacity-50' : ''}`}
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function PlaylistCard({
  manifest,
  peerAddr,
  isLocal,
  isDownloading,
  onDownload,
}: {
  manifest: PlaylistManifest
  peerAddr: string
  isLocal: boolean
  isDownloading: boolean
  onDownload: () => void
}) {
  const meta = (
    <div className="min-w-0 flex-1">
      <div className={`text-sm font-medium truncate ${isLocal ? '' : 'opacity-60'}`}>{manifest.name}</div>
      {manifest.description && (
        <div className={`text-xs truncate mt-0.5 ${isLocal ? 'opacity-50' : 'opacity-35'}`}>
          {manifest.description}
        </div>
      )}
      <div className="text-xs font-mono opacity-40 mt-0.5">
        {manifest.track_count} track{manifest.track_count !== 1 ? 's' : ''} · {formatBytes(manifest.size_bytes)}
      </div>
    </div>
  )

  if (isLocal) {
    return (
      <div className="bg-base-200 rounded-lg p-3 flex items-center gap-3">
        {manifest.artwork_hash && <ArtworkThumb hash={manifest.artwork_hash} peerAddr={peerAddr} faded={false} />}
        {meta}
        <span className="text-xs text-success shrink-0">Synced</span>
      </div>
    )
  }

  return (
    <div className="border border-dashed border-base-content/15 bg-base-200/40 rounded-lg p-3 flex items-center gap-3">
      {manifest.artwork_hash && <ArtworkThumb hash={manifest.artwork_hash} peerAddr={peerAddr} faded={true} />}
      {meta}
      <button
        className="btn btn-xs btn-outline shrink-0 gap-1"
        disabled={isDownloading}
        onClick={onDownload}
      >
        {isDownloading
          ? <span className="loading loading-spinner loading-xs" />
          : <HiCloudDownload className="text-base" />}
        {isDownloading ? 'Downloading…' : 'Download'}
      </button>
    </div>
  )
}

function PeerPlaylistsModalInner({ platform }: { platform: 'desktop' | 'mobile' }) {
  const peerManifestPeer      = useStore(s => s.peerManifestPeer)
  const peerManifest          = useStore(s => s.peerManifest)
  const peerManifestLoading   = useStore(s => s.peerManifestLoading)
  const downloadingPlaylists  = useStore(s => s.downloadingPlaylists)
  const closePeerManifest     = useStore(s => s.closePeerManifest)
  const downloadPlaylist      = useStore(s => s.downloadPlaylist)
  const localPlaylists        = useStore(s => s.playlists)

  const localIds = new Set(localPlaylists.map(p => p.id))
  const peerName = peerManifestPeer?.display_name ?? 'Peer'
  const peerAddr = peerManifestPeer?.addr ?? ''

  const header = (
    <div className="flex items-center justify-between mb-4">
      <div className="font-semibold text-sm truncate pr-2">Playlists from {peerName}</div>
      <button
        onClick={closePeerManifest}
        className="btn btn-ghost btn-xs opacity-60 hover:opacity-100 shrink-0"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  )

  let body: React.ReactNode
  if (peerManifestLoading) {
    body = (
      <div className="flex items-center justify-center py-12">
        <span className="loading loading-spinner loading-md opacity-40" />
      </div>
    )
  } else if (!peerManifest || peerManifest.length === 0) {
    body = (
      <div className="text-center text-sm opacity-40 py-10">
        {peerManifest ? 'No playlists found on this device' : 'Could not load playlists'}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2">
        {peerManifest.map(manifest => (
          <PlaylistCard
            key={manifest.id}
            manifest={manifest}
            peerAddr={peerAddr}
            isLocal={localIds.has(manifest.id)}
            isDownloading={downloadingPlaylists.includes(manifest.id)}
            onDownload={() => downloadPlaylist(manifest.id, manifest.branches?.length > 0 ? manifest.branches : ['main'])}
          />
        ))}
      </div>
    )
  }

  if (platform === 'mobile') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={closePeerManifest}
        />
        <div
          className="relative bg-base-100 rounded-t-2xl p-5 pb-safe overflow-y-auto"
          style={{ maxHeight: '85vh' }}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closePeerManifest}
      />
      <div className="relative bg-base-100 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 max-h-[85vh] overflow-y-auto">
        {header}
        {body}
      </div>
    </div>
  )
}

export function PeerPlaylistsModal({ platform }: { platform: 'desktop' | 'mobile' }) {
  const peerManifestOpen = useStore(s => s.peerManifestOpen)
  if (!peerManifestOpen) return null
  return <PeerPlaylistsModalInner platform={platform} />
}
