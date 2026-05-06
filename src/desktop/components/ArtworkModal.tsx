import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IcoClose } from '../icons';
import { FiUpload, FiImage, FiEdit2, FiCheck, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import type { Track } from '../data';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArtworkLibraryEntry {
  artwork_hash: string;
  album:        string | null;
  artist:       string;
  track_count:  number;
}

interface BulkArtworkResult {
  new_artwork_hash: string;
  affected_hashes:  string[];
}

export interface ArtworkModalProps {
  trackHash?:  string;
  trackPath?:  string;
  tracks?:     Track[];
  onSaved:     (newUrl: string, affectedHashes?: string[]) => void;
  onClose:     () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DISPLAY  = 380;
const OUT_SIZE = 500;
const MIN_CROP = 30;
const HANDLE_R = 5;   // handle circle radius for drawing
const HANDLE_HIT = 9; // hit-test radius

// ── Handle types ──────────────────────────────────────────────────────────────

type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSOR: Record<HandleKey, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
  se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
};

type DragState =
  | { mode: 'move';   startMX: number; startMY: number; startCX: number; startCY: number }
  | { mode: 'resize'; handle: HandleKey; anchor: { x: number; y: number }; startMX: number; startMY: number };

// ── Scope types ───────────────────────────────────────────────────────────────

type ScopeMode = 'this' | 'all-artwork' | 'album' | 'artist' | 'choose';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function getHandlePoints(crop: { x: number; y: number; size: number }): Record<HandleKey, { x: number; y: number }> {
  const { x, y, size } = crop;
  const cx = x + size / 2, cy = y + size / 2;
  return {
    nw: { x, y },          n: { x: cx, y },         ne: { x: x + size, y },
    w:  { x, y: cy },                                 e: { x: x + size, y: cy },
    sw: { x, y: y + size }, s: { x: cx, y: y + size }, se: { x: x + size, y: y + size },
  };
}

function hitHandle(mx: number, my: number, crop: { x: number; y: number; size: number }): HandleKey | null {
  const pts = getHandlePoints(crop);
  for (const [k, p] of Object.entries(pts)) {
    if (Math.hypot(mx - p.x, my - p.y) <= HANDLE_HIT) return k as HandleKey;
  }
  return null;
}

function insideCrop(mx: number, my: number, crop: { x: number; y: number; size: number }) {
  return mx >= crop.x && mx <= crop.x + crop.size && my >= crop.y && my <= crop.y + crop.size;
}

// Compute new crop when dragging a resize handle
function applyResize(
  handle: HandleKey,
  anchor: { x: number; y: number },
  mx: number, my: number,
  layout: { drawX: number; drawY: number; drawW: number; drawH: number },
): { x: number; y: number; size: number } {
  const maxSize = Math.min(layout.drawW, layout.drawH);
  let size: number, x: number, y: number;

  switch (handle) {
    case 'se': size = clamp(Math.max(mx - anchor.x, my - anchor.y), MIN_CROP, maxSize); x = anchor.x; y = anchor.y; break;
    case 'nw': size = clamp(Math.max(anchor.x - mx, anchor.y - my), MIN_CROP, maxSize); x = anchor.x - size; y = anchor.y - size; break;
    case 'ne': size = clamp(Math.max(mx - anchor.x, anchor.y - my), MIN_CROP, maxSize); x = anchor.x; y = anchor.y - size; break;
    case 'sw': size = clamp(Math.max(anchor.x - mx, my - anchor.y), MIN_CROP, maxSize); x = anchor.x - size; y = anchor.y; break;
    case 's':  size = clamp(my - anchor.y, MIN_CROP, maxSize); x = anchor.x - size / 2; y = anchor.y; break;
    case 'n':  size = clamp(anchor.y - my, MIN_CROP, maxSize); x = anchor.x - size / 2; y = anchor.y - size; break;
    case 'e':  size = clamp(mx - anchor.x, MIN_CROP, maxSize); x = anchor.x; y = anchor.y - size / 2; break;
    case 'w':  size = clamp(anchor.x - mx, MIN_CROP, maxSize); x = anchor.x - size; y = anchor.y - size / 2; break;
    default:   return { x: 0, y: 0, size: MIN_CROP };
  }

  return {
    size,
    x: clamp(x, layout.drawX, layout.drawX + layout.drawW - size),
    y: clamp(y, layout.drawY, layout.drawY + layout.drawH - size),
  };
}

// Anchor = the handle point on the opposite side of the crop box
function getAnchor(handle: HandleKey, crop: { x: number; y: number; size: number }): { x: number; y: number } {
  const opposite: Record<HandleKey, HandleKey> = {
    nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e',
  };
  return getHandlePoints(crop)[opposite[handle]];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArtworkModal({ trackHash, trackPath, tracks = [], onSaved, onClose }: ArtworkModalProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Canvas / image state
  const [imgUrl,    setImgUrl]    = useState<string | null>(null);
  const [nativeImg, setNativeImg] = useState<HTMLImageElement | null>(null);
  const [layout,    setLayout]    = useState({ drawX: 0, drawY: 0, drawW: DISPLAY, drawH: DISPLAY });
  const [crop,      setCrop]      = useState({ x: 0, y: 0, size: DISPLAY * 0.8 });
  const [cursor,    setCursor]    = useState('default');
  const dragRef = useRef<DragState | null>(null);

  // Library state
  const [artLibrary,     setArtLibrary]     = useState<ArtworkLibraryEntry[]>([]);
  const [thumbUrls,      setThumbUrls]      = useState<Record<string, string>>({});
  const [hoveredLib,     setHoveredLib]     = useState<string | null>(null);
  const [sourceLibEntry, setSourceLibEntry] = useState<ArtworkLibraryEntry | null>(null);

  // Scope-selector state
  const [scopeOpen,      setScopeOpen]      = useState(false);
  const [scopeMode,      setScopeMode]      = useState<ScopeMode>('this');
  const [chooseExpanded, setChooseExpanded] = useState(false);
  const [chooseSearch,   setChooseSearch]   = useState('');
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const pendingBytesRef = useRef<number[] | null>(null);
  const pendingUrlRef   = useRef<string | null>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isFetchingUrl,  setIsFetchingUrl]  = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);
  const [saveErr,        setSaveErr]        = useState<string | null>(null);

  // ── Current track (for album/artist scope labels) ────────────────────────
  const currentTrack = useMemo(() => tracks.find(t => t.hash === trackHash), [tracks, trackHash]);

  const albumTracks  = useMemo(() =>
    currentTrack?.album && currentTrack.album !== 'Unknown Album'
      ? tracks.filter(t => t.album === currentTrack.album)
      : [],
  [tracks, currentTrack]);

  const artistTracks = useMemo(() =>
    currentTrack?.artist && currentTrack.artist !== 'Unknown Artist'
      ? tracks.filter(t => t.artist === currentTrack.artist)
      : [],
  [tracks, currentTrack]);

  // ── Load artwork library ─────────────────────────────────────────────────
  const refreshLibrary = useCallback(() => {
    invoke<ArtworkLibraryEntry[]>('get_artwork_library')
      .then(setArtLibrary)
      .catch(console.error);
  }, []);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  useEffect(() => {
    for (const entry of artLibrary) {
      if (thumbUrls[entry.artwork_hash]) continue;
      invoke<number[]>('get_artwork_blob', { artworkHash: entry.artwork_hash })
        .then(bytes => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
          setThumbUrls(prev => ({ ...prev, [entry.artwork_hash]: url }));
        })
        .catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artLibrary]);

  // ── Canvas draw ──────────────────────────────────────────────────────────
  const draw = useCallback((img: HTMLImageElement, l: typeof layout, c: typeof crop) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, DISPLAY, DISPLAY);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, DISPLAY, DISPLAY);
    ctx.drawImage(img, l.drawX, l.drawY, l.drawW, l.drawH);

    // Dark overlay outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, 0, DISPLAY, c.y);
    ctx.fillRect(0, c.y + c.size, DISPLAY, DISPLAY - c.y - c.size);
    ctx.fillRect(0, c.y, c.x, c.size);
    ctx.fillRect(c.x + c.size, c.y, DISPLAY - c.x - c.size, c.size);

    // Crop border
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x + 0.75, c.y + 0.75, c.size - 1.5, c.size - 1.5);

    // Rule-of-thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.75;
    for (let i = 1; i < 3; i++) {
      const px = c.x + (c.size / 3) * i, py = c.y + (c.size / 3) * i;
      ctx.beginPath(); ctx.moveTo(px, c.y); ctx.lineTo(px, c.y + c.size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x, py); ctx.lineTo(c.x + c.size, py); ctx.stroke();
    }

    // Resize handles
    const pts = getHandlePoints(c);
    ctx.fillStyle   = 'white';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth   = 1;
    for (const p of Object.values(pts)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    if (nativeImg) draw(nativeImg, layout, crop);
  }, [nativeImg, layout, crop, draw]);

  // ── Load image ────────────────────────────────────────────────────────────
  const loadImage = useCallback((src: string, libEntry: ArtworkLibraryEntry | null = null) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(DISPLAY / img.naturalWidth, DISPLAY / img.naturalHeight);
      const drawW = img.naturalWidth  * scale;
      const drawH = img.naturalHeight * scale;
      const drawX = (DISPLAY - drawW) / 2;
      const drawY = (DISPLAY - drawH) / 2;
      const side  = Math.min(drawW, drawH) * 0.92;
      const newLayout = { drawX, drawY, drawW, drawH };
      const newCrop   = { x: drawX + (drawW - side) / 2, y: drawY + (drawH - side) / 2, size: side };
      setNativeImg(img);
      setLayout(newLayout);
      setCrop(newCrop);
      setSourceLibEntry(libEntry);
      draw(img, newLayout, newCrop);
    };
    img.src = src;
  }, [draw]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    loadImage(url, null);
  }, [imgUrl, loadImage]);

  // ── Library thumbnail actions ─────────────────────────────────────────────
  const applyLibraryArtwork = useCallback(async (entry: ArtworkLibraryEntry) => {
    if (!thumbUrls[entry.artwork_hash]) return;
    setIsSaving(true);
    setSaveErr(null);
    try {
      const bytes  = await invoke<number[]>('get_artwork_blob', { artworkHash: entry.artwork_hash });
      const arr    = new Uint8Array(bytes);
      const newUrl = URL.createObjectURL(new Blob([arr]));
      if (trackHash) {
        await invoke('library_set_artwork', { hash: trackHash, imageBytes: Array.from(arr) });
      } else if (trackPath) {
        await invoke('file_set_artwork', { path: trackPath, imageBytes: Array.from(arr) });
      }
      refreshLibrary();
      onSaved(newUrl);
    } catch (e) {
      setSaveErr(String(e));
    } finally {
      setIsSaving(false);
    }
  }, [thumbUrls, trackHash, trackPath, onSaved, refreshLibrary]);

  const editLibraryArtwork = useCallback((entry: ArtworkLibraryEntry) => {
    const url = thumbUrls[entry.artwork_hash];
    if (!url) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(url);
    loadImage(url, entry);
    // Reset scope to default when loading a new source
    setScopeMode(entry ? 'all-artwork' : 'this');
  }, [thumbUrls, imgUrl, loadImage]);

  // ── Mouse interaction ─────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!nativeImg) return;
    const { x: mx, y: my } = getCanvasPos(e);
    const handle = hitHandle(mx, my, crop);
    if (handle) {
      dragRef.current = {
        mode: 'resize', handle,
        anchor: getAnchor(handle, crop),
        startMX: mx, startMY: my,
      };
    } else if (insideCrop(mx, my, crop)) {
      dragRef.current = { mode: 'move', startMX: mx, startMY: my, startCX: crop.x, startCY: crop.y };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeImg, crop]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x: mx, y: my } = getCanvasPos(e);
    const d = dragRef.current;

    if (d) {
      if (d.mode === 'resize') {
        setCrop(applyResize(d.handle, d.anchor, mx, my, layout));
      } else {
        setCrop(c => ({
          ...c,
          x: clamp(d.startCX + (mx - d.startMX), layout.drawX, layout.drawX + layout.drawW - c.size),
          y: clamp(d.startCY + (my - d.startMY), layout.drawY, layout.drawY + layout.drawH - c.size),
        }));
      }
    } else if (nativeImg) {
      // Update cursor based on hover target
      const h = hitHandle(mx, my, crop);
      if (h) setCursor(HANDLE_CURSOR[h]);
      else if (insideCrop(mx, my, crop)) setCursor('move');
      else setCursor('crosshair');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeImg, layout, crop]);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  // ── Build cropped blob ────────────────────────────────────────────────────
  const buildCroppedBlob = useCallback(async (): Promise<{ arr: number[]; url: string }> => {
    if (!nativeImg) throw new Error('No image loaded');
    const scaleX = nativeImg.naturalWidth  / layout.drawW;
    const scaleY = nativeImg.naturalHeight / layout.drawH;
    const srcX   = (crop.x - layout.drawX) * scaleX;
    const srcY   = (crop.y - layout.drawY) * scaleY;
    const srcS   = crop.size * Math.min(scaleX, scaleY);

    if (!offCanvasRef.current) offCanvasRef.current = document.createElement('canvas');
    const off = offCanvasRef.current;
    off.width  = OUT_SIZE;
    off.height = OUT_SIZE;
    off.getContext('2d')!.drawImage(nativeImg, srcX, srcY, srcS, srcS, 0, 0, OUT_SIZE, OUT_SIZE);

    const blob = await new Promise<Blob>((res, rej) =>
      off.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.92)
    );
    return { arr: Array.from(new Uint8Array(await blob.arrayBuffer())), url: URL.createObjectURL(blob) };
  }, [nativeImg, layout, crop]);

  // ── Open scope selector ───────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!nativeImg || isSaving) return;
    setSaveErr(null);
    setIsSaving(true);
    try {
      const { arr, url } = await buildCroppedBlob();
      pendingBytesRef.current = arr;
      pendingUrlRef.current   = url;
      // Filesystem files have no scope — save directly
      if (trackPath && !trackHash) {
        await invoke('file_set_artwork', { path: trackPath, imageBytes: arr });
        refreshLibrary();
        onSaved(url);
        return;
      }
      setScopeMode(sourceLibEntry ? 'all-artwork' : 'this');
      setScopeOpen(true);
    } catch (e) {
      setSaveErr(String(e));
    } finally {
      setIsSaving(false);
    }
  }, [nativeImg, isSaving, buildCroppedBlob, trackPath, trackHash, sourceLibEntry, onSaved, refreshLibrary]);

  // ── Execute save for the chosen scope ────────────────────────────────────
  const executeScope = useCallback(async () => {
    const arr = pendingBytesRef.current;
    const url = pendingUrlRef.current;
    if (!arr || !url) return;
    setIsSaving(true);
    setSaveErr(null);
    try {
      let result: BulkArtworkResult | null = null;

      if (scopeMode === 'all-artwork' && sourceLibEntry) {
        result = await invoke<BulkArtworkResult>('library_replace_artwork', {
          oldArtworkHash: sourceLibEntry.artwork_hash,
          imageBytes: arr,
        });
      } else {
        let hashes: string[] = [];
        if (scopeMode === 'this' && trackHash)     hashes = [trackHash];
        else if (scopeMode === 'album')             hashes = albumTracks.map(t => t.hash);
        else if (scopeMode === 'artist')            hashes = artistTracks.map(t => t.hash);
        else if (scopeMode === 'choose')            hashes = Array.from(selectedHashes);
        if (hashes.length > 0) {
          result = await invoke<BulkArtworkResult>('library_set_artwork_for_tracks', { hashes, imageBytes: arr });
        }
      }

      refreshLibrary();
      onSaved(url, result?.affected_hashes);
    } catch (e) {
      setSaveErr(String(e));
      setIsSaving(false);
    }
  }, [scopeMode, sourceLibEntry, trackHash, albumTracks, artistTracks, selectedHashes, onSaved, refreshLibrary]);

  const toggleChooseHash = (hash: string) =>
    setSelectedHashes(prev => { const n = new Set(prev); n.has(hash) ? n.delete(hash) : n.add(hash); return n; });

  // ── Drop zone ─────────────────────────────────────────────────────────────
  const loadImageFromUrl = useCallback(async (url: string) => {
    setIsFetchingUrl(true);
    setSaveErr(null);
    try {
      const bytes = await invoke<number[]>('fetch_image_url', { url });
      const arr   = new Uint8Array(bytes);
      const blob  = new Blob([arr]);
      const objUrl = URL.createObjectURL(blob);
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      setImgUrl(objUrl);
      loadImage(objUrl, null);
    } catch (e) {
      setSaveErr(`Could not load image from URL: ${e}`);
    } finally {
      setIsFetchingUrl(false);
    }
  }, [imgUrl, loadImage]);

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingOver(true);  };
  const handleDragLeave = ()                    => { setIsDraggingOver(false); };
  const handleDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    // 1. Actual image file (local drag or some browsers provide this for web images)
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (file) { loadFile(file); return; }

    // 2. Image item from DataTransferItemList (Firefox sometimes uses this)
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) { loadFile(f); return; }
      }
    }

    // 3. URI list — most common for web browser image drags (Chrome, Google Images)
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      const url = uriList.split(/\r?\n/).find(u => u.trim() && !u.startsWith('#') && u.startsWith('http'));
      if (url) { loadImageFromUrl(url.trim()); return; }
    }

    // 4. HTML with <img src="…"> — fallback for some browsers
    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const match = html.match(/src=["']([^"']+)["']/i);
      if (match?.[1]?.startsWith('http')) { loadImageFromUrl(match[1]); return; }
    }
  }, [loadFile, loadImageFromUrl]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        width: 680, maxHeight: '90vh',
        background: 'var(--bg-2)', border: '1px solid var(--border-1)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border-0)', flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
              {scopeOpen ? 'Apply Artwork To…' : 'Edit Artwork'}
            </span>
            {!scopeOpen && sourceLibEntry && (
              <div style={{ fontSize: 11, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                Editing: {sourceLibEntry.album ?? sourceLibEntry.artist} · {sourceLibEntry.track_count} track{sourceLibEntry.track_count !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', display: 'flex', padding: 4 }}
          >
            <IcoClose size={16} />
          </button>
        </div>

        {/* ── SCOPE SELECTOR VIEW ──────────────────────────────────────── */}
        {scopeOpen ? (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16, fontFamily: "'Outfit', sans-serif", lineHeight: 1.5 }}>
                Choose which tracks to update. The existing artwork on affected tracks will be replaced.
              </p>

              {[
                sourceLibEntry ? {
                  mode: 'all-artwork' as ScopeMode,
                  label: `All tracks with this artwork`,
                  sub: `${sourceLibEntry.track_count} track${sourceLibEntry.track_count !== 1 ? 's' : ''} currently share this artwork`,
                } : null,
                trackHash ? { mode: 'this' as ScopeMode, label: 'Just this track', sub: currentTrack?.title ?? trackHash } : null,
                albumTracks.length > 0 ? {
                  mode: 'album' as ScopeMode,
                  label: `Same album: "${currentTrack?.album}"`,
                  sub: `${albumTracks.length} track${albumTracks.length !== 1 ? 's' : ''}`,
                } : null,
                artistTracks.length > 0 ? {
                  mode: 'artist' as ScopeMode,
                  label: `Same artist: "${currentTrack?.artist}"`,
                  sub: `${artistTracks.length} track${artistTracks.length !== 1 ? 's' : ''}`,
                } : null,
                tracks.length > 0 ? {
                  mode: 'choose' as ScopeMode,
                  label: 'Choose tracks…',
                  sub: selectedHashes.size > 0 ? `${selectedHashes.size} selected` : 'Pick from library',
                } : null,
              ].filter(Boolean).map(opt => (
                <div key={opt!.mode} style={{ marginBottom: 4 }}>
                  <button
                    onClick={() => {
                      setScopeMode(opt!.mode);
                      if (opt!.mode === 'choose') setChooseExpanded(true);
                      else { setChooseSearch(''); }
                    }}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 7,
                      background: scopeMode === opt!.mode ? 'var(--accent-dim)' : 'var(--bg-3)',
                      border: `1px solid ${scopeMode === opt!.mode ? 'var(--accent)' : 'var(--border-1)'}`,
                      cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s',
                    }}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${scopeMode === opt!.mode ? 'var(--accent)' : 'var(--border-2)'}`,
                      background: scopeMode === opt!.mode ? 'var(--accent)' : 'transparent',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
                        {opt!.label}
                      </div>
                      <div style={{ fontSize: 11, color: scopeMode === opt!.mode ? 'var(--accent-light)' : 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                        {opt!.sub}
                      </div>
                    </div>
                    {opt!.mode === 'choose' && (
                      <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                        {chooseExpanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                      </span>
                    )}
                  </button>

                  {/* Expandable track checklist */}
                  {opt!.mode === 'choose' && scopeMode === 'choose' && chooseExpanded && (() => {
                    const q = chooseSearch.trim().toLowerCase();
                    const visible = q
                      ? tracks.filter(t =>
                          t.title.toLowerCase().includes(q) ||
                          t.artist.toLowerCase().includes(q) ||
                          t.album.toLowerCase().includes(q)
                        )
                      : tracks;
                    return (
                      <div style={{
                        marginTop: 4, borderRadius: 6,
                        border: '1px solid var(--border-1)',
                        background: 'var(--bg-1)',
                        overflow: 'hidden',
                      }}>
                        {/* Search bar */}
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-1)' }}>
                          <input
                            type="text"
                            placeholder="Search tracks…"
                            value={chooseSearch}
                            onChange={e => setChooseSearch(e.target.value)}
                            autoFocus
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                              borderRadius: 4, padding: '5px 9px',
                              fontSize: 12, color: 'var(--text-0)',
                              fontFamily: "'Outfit', sans-serif",
                              outline: 'none',
                            }}
                          />
                        </div>
                        {/* Track list */}
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {visible.length === 0 && (
                            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif" }}>
                              No tracks match
                            </div>
                          )}
                          {visible.map(t => (
                            <label
                              key={t.hash}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 14px', cursor: 'pointer',
                                borderBottom: '1px solid var(--border-0)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedHashes.has(t.hash)}
                                onChange={() => toggleChooseHash(t.hash)}
                                style={{
                                  accentColor: 'var(--accent)', flexShrink: 0,
                                  width: 14, height: 14, margin: 0, cursor: 'pointer',
                                }}
                              />
                              <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: "'Outfit', sans-serif", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.title}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                                {t.artist}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}

              {saveErr && (
                <p style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace', marginTop: 12" }}>✗ {saveErr}</p>
              )}
            </div>

            {/* Scope footer */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              padding: '12px 20px', borderTop: '1px solid var(--border-0)', flexShrink: 0,
            }}>
              <button
                onClick={() => { setScopeOpen(false); setSaveErr(null); }}
                style={{ padding: '7px 16px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-1)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
              >
                Back
              </button>
              <button
                onClick={executeScope}
                disabled={isSaving || (scopeMode === 'choose' && selectedHashes.size === 0)}
                style={{
                  padding: '7px 20px', borderRadius: 5,
                  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                  fontSize: 12, color: 'var(--accent-light)', cursor: 'pointer',
                  fontFamily: "'Outfit', sans-serif", fontWeight: 600,
                  opacity: (isSaving || (scopeMode === 'choose' && selectedHashes.size === 0)) ? 0.5 : 1,
                }}
              >
                {isSaving ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </>
        ) : (

          /* ── NORMAL EDITOR VIEW ───────────────────────────────────────── */
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>

              {/* Canvas + drop zone */}
              <div style={{ display: 'flex', gap: 18, marginBottom: 20 }}>
                <div style={{ flexShrink: 0, position: 'relative' }}>
                  <canvas
                    ref={canvasRef}
                    width={DISPLAY} height={DISPLAY}
                    style={{ display: 'block', borderRadius: 8, border: '1px solid var(--border-1)', cursor, userSelect: 'none' }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={stopDrag}
                    onMouseLeave={stopDrag}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  />
                  {!nativeImg && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-3)', flexDirection: 'column', gap: 8, pointerEvents: 'none',
                    }}>
                      <FiImage size={32} />
                      <span style={{ fontSize: 11, fontFamily: "'Outfit', sans-serif" }}>No image loaded</span>
                    </div>
                  )}
                </div>

                {/* Drop zone */}
                <div
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 12,
                    border: `2px dashed ${isDraggingOver ? 'var(--accent)' : 'var(--border-2)'}`,
                    borderRadius: 8, padding: '20px 14px',
                    background: isDraggingOver ? 'var(--accent-dim)' : 'var(--bg-1)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <FiUpload size={24} style={{ color: isDraggingOver ? 'var(--accent)' : isFetchingUrl ? 'var(--accent-light)' : 'var(--text-3)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center', fontFamily: "'Outfit', sans-serif", lineHeight: 1.5 }}>
                    {isFetchingUrl ? 'Fetching image…' : isDraggingOver ? 'Release to load' : 'Drop an image or URL here'}
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{ padding: '7px 16px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-1)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontWeight: 500 }}
                  >
                    Browse…
                  </button>
                  <input
                    ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
                    JPEG · PNG · WebP · URL{'\n'}Drag from browser or drop a local file
                  </span>
                  {nativeImg && (
                    <span style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: "'JetBrains Mono', monospace" }}>
                      Drag to reframe · drag handles to crop
                    </span>
                  )}
                </div>
              </div>

              {/* Artwork library */}
              {artLibrary.length > 0 && (
                <div>
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', fontFamily: "'Outfit', sans-serif", marginBottom: 10 }}>
                    From your artwork library
                  </span>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    {artLibrary.map(entry => {
                      const thumb = thumbUrls[entry.artwork_hash];
                      const label = entry.album ?? entry.artist;
                      const isHov = hoveredLib === entry.artwork_hash;
                      return (
                        <div
                          key={entry.artwork_hash}
                          style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}
                          onMouseEnter={() => setHoveredLib(entry.artwork_hash)}
                          onMouseLeave={() => setHoveredLib(null)}
                        >
                          <div style={{ width: 60, height: 60, border: `1.5px solid ${isHov ? 'var(--accent)' : 'var(--border-1)'}`, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-4)', transition: 'border-color 0.12s' }}>
                            {thumb
                              ? <img src={thumb} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              : <FiImage size={18} style={{ color: 'var(--text-3)', margin: '21px auto', display: 'block' }} />
                            }
                          </div>
                          {isHov && (
                            <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <button
                                title="Apply to this track"
                                onClick={() => applyLibraryArtwork(entry)}
                                disabled={isSaving}
                                style={{ width: 24, height: 24, borderRadius: 4, padding: 0, background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                              >
                                <FiCheck size={13} style={{ color: 'var(--accent-light)' }} />
                              </button>
                              <button
                                title={`Edit artwork (${entry.track_count} tracks)`}
                                onClick={() => editLibraryArtwork(entry)}
                                style={{ width: 24, height: 24, borderRadius: 4, padding: 0, background: 'var(--bg-4)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                              >
                                <FiEdit2 size={13} style={{ color: 'var(--text-1)' }} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                    ✓ applies to this track · ✎ loads into editor
                  </p>
                </div>
              )}
            </div>

            {/* Normal footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--border-0)', flexShrink: 0, gap: 12 }}>
              {saveErr
                ? <span style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace", flex: 1 }}>✗ {saveErr}</span>
                : <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>Output: {OUT_SIZE} × {OUT_SIZE} JPEG</span>
              }
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-1)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}>
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!nativeImg || isSaving}
                  style={{ padding: '7px 20px', borderRadius: 5, background: 'var(--accent-dim)', border: '1px solid var(--accent)', fontSize: 12, color: 'var(--accent-light)', cursor: (!nativeImg || isSaving) ? 'not-allowed' : 'pointer', fontFamily: "'Outfit', sans-serif", fontWeight: 600, opacity: (!nativeImg || isSaving) ? 0.5 : 1 }}
                >
                  {isSaving ? 'Saving…' : 'Save Artwork'}
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </ModalOverlay>
  );
}
