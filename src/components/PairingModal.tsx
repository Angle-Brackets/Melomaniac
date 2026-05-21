import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'
import type { QrPayload } from '../store/types'

function useCountdown(expUnix: number | null, onExpired: () => void): number {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    expUnix ? Math.max(0, expUnix - Math.floor(Date.now() / 1000)) : 0
  )
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  useEffect(() => {
    if (expUnix === null) return
    const tick = () => {
      const left = Math.max(0, expUnix - Math.floor(Date.now() / 1000))
      setSecondsLeft(left)
      if (left === 0) onExpiredRef.current()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expUnix])

  return secondsLeft
}

function QrImage({ payload }: { payload: QrPayload }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(JSON.stringify(payload), { width: 240, margin: 2 })
      .then(url => { if (!cancelled) setDataUrl(url) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [payload])

  if (!dataUrl) {
    return (
      <div className="w-[240px] h-[240px] bg-base-200 rounded-lg flex items-center justify-center">
        <span className="loading loading-spinner loading-md opacity-40" />
      </div>
    )
  }

  return (
    <img
      src={dataUrl}
      alt="Pairing QR code"
      className="rounded-lg"
      width={240}
      height={240}
    />
  )
}

function DisplayMode({ platform }: { platform: 'desktop' | 'mobile' }) {
  const qrPayload          = useStore(s => s.qrPayload)
  const fingerprint        = useStore(s => s.fingerprint)
  const knownDevices       = useStore(s => s.knownDevices)
  const livePeers          = useStore(s => s.livePeers)
  const openPairingDisplay = useStore(s => s.openPairingDisplay)
  const openPairingScanner = useStore(s => s.openPairingScanner)
  const refreshLivePeers   = useStore(s => s.refreshLivePeers)
  const openPeerManifest   = useStore(s => s.openPeerManifest)
  const [copied, setCopied] = useState(false)

  const copyJson = () => {
    if (!qrPayload) return
    navigator.clipboard.writeText(JSON.stringify(qrPayload)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Poll for live peers while the modal is open
  useEffect(() => {
    refreshLivePeers()
    const id = setInterval(refreshLivePeers, 4000)
    return () => clearInterval(id)
  }, [refreshLivePeers])

  const secondsLeft = useCountdown(
    qrPayload?.exp ?? null,
    openPairingDisplay,
  )

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-xs font-mono opacity-50 text-center">
        Your fingerprint: <span className="font-bold opacity-80">{fingerprint}</span>
      </div>

      {qrPayload && <QrImage payload={qrPayload} />}

      <div className={`text-xs font-mono ${secondsLeft <= 10 ? 'text-warning' : 'opacity-50'}`}>
        {secondsLeft > 0 ? `Expires in ${secondsLeft}s` : 'Refreshing…'}
      </div>

      {platform === 'desktop' && qrPayload && (
        <>
          <button
            className="btn btn-xs btn-outline w-full"
            onClick={copyJson}
          >
            {copied ? '✓ Copied' : 'Copy pairing code'}
          </button>
          {qrPayload.addr
            ? <div className="text-xs font-mono opacity-40">Reachable at {qrPayload.addr}</div>
            : <div className="text-xs text-warning opacity-80">Could not detect local IP — back-channel unavailable</div>
          }
        </>
      )}

      {platform === 'mobile' && (
        <button
          className="btn btn-sm btn-outline w-full"
          onClick={openPairingScanner}
        >
          Switch to scan mode
        </button>
      )}

      {livePeers.length > 0 && (
        <div className="w-full mt-2">
          <div className="text-xs font-mono uppercase tracking-widest opacity-40 mb-2">
            Nearby
          </div>
          <div className="flex flex-col gap-1">
            {livePeers.map(peer => (
              <div
                key={peer.public_key_b64}
                className="flex items-center justify-between bg-base-200 rounded px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{peer.display_name}</div>
                  {peer.latency_ms != null && (
                    <div className="text-xs font-mono opacity-40">{peer.latency_ms}ms</div>
                  )}
                </div>
                <button
                  className="btn btn-xs btn-primary"
                  onClick={() => openPeerManifest(peer)}
                >
                  Sync
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {knownDevices.length > 0 && (
        <div className="w-full mt-2">
          <div className="text-xs font-mono uppercase tracking-widest opacity-40 mb-2">
            Paired devices
          </div>
          <div className="flex flex-col gap-1">
            {knownDevices.map(device => {
              const livePeer = livePeers.find(p => p.public_key_b64 === device.public_key_b64)
              return (
                <div
                  key={device.public_key_b64}
                  className="flex items-center justify-between bg-base-200 rounded px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate">{device.display_name}</div>
                    {livePeer?.latency_ms != null && (
                      <div className="text-xs font-mono opacity-40">{livePeer.latency_ms}ms</div>
                    )}
                  </div>
                  {livePeer ? (
                    <button
                      className="btn btn-xs btn-primary shrink-0 ml-2"
                      onClick={() => openPeerManifest(livePeer)}
                    >
                      Sync
                    </button>
                  ) : (
                    <span className="text-xs font-mono opacity-40 ml-2 shrink-0">
                      {new Date(device.added_at * 1000).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ScanMode() {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitScannedQr = useStore(s => s.submitScannedQr)

  const handleConfirm = async () => {
    setError(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setError('Could not parse JSON — paste the full QR code text')
      return
    }

    if (
      typeof parsed !== 'object' || parsed === null ||
      !('public_key_b64' in parsed) || !('token' in parsed) ||
      !('exp' in parsed) || !('display_name' in parsed)
    ) {
      setError('Invalid QR payload — missing required fields')
      return
    }

    setSubmitting(true)
    try {
      await submitScannedQr(parsed as QrPayload)
    } catch (e) {
      setError(`Pairing failed: ${e instanceof Error ? e.message : String(e)}`)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="rounded-lg bg-base-200 p-4 text-sm text-center opacity-70">
        Point your camera at the desktop's QR code, then paste the text below
      </div>

      <textarea
        className="textarea textarea-bordered w-full font-mono text-xs"
        rows={5}
        placeholder='{"public_key_b64":"…","display_name":"…","addr":null,"token":"…","exp":0}'
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={submitting}
      />

      {error && (
        <div className="text-xs text-error break-all">{error}</div>
      )}

      <button
        className="btn btn-primary btn-sm w-full"
        disabled={text.trim() === '' || submitting}
        onClick={handleConfirm}
      >
        {submitting
          ? <span className="loading loading-spinner loading-xs" />
          : 'Confirm'}
      </button>
    </div>
  )
}

function PairingModalInner({ platform }: { platform: 'desktop' | 'mobile' }) {
  const pairingMode  = useStore(s => s.pairingMode)
  const closePairing = useStore(s => s.closePairing)

  const header = (
    <div className="flex items-center justify-between mb-4">
      <div className="font-semibold text-sm">Pair a device</div>
      <button
        onClick={closePairing}
        className="btn btn-ghost btn-xs opacity-60 hover:opacity-100"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  )

  const body = pairingMode === 'display'
    ? <DisplayMode platform={platform} />
    : <ScanMode />

  if (platform === 'mobile') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={closePairing}
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
        onClick={closePairing}
      />
      <div className="relative bg-base-100 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 max-h-[85vh] overflow-y-auto">
        {header}
        {body}
      </div>
    </div>
  )
}

export function PairingModal({ platform }: { platform: 'desktop' | 'mobile' }) {
  const pairingOpen = useStore(s => s.pairingOpen)
  if (!pairingOpen) return null
  return <PairingModalInner platform={platform} />
}
