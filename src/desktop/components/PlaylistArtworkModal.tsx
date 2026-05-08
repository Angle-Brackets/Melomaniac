import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IcoClose } from '../icons';
import { FiUpload, FiImage } from 'react-icons/fi';

// ── Constants ─────────────────────────────────────────────────────────────────

const DISPLAY  = 340;
const OUT_SIZE = 500;
const MIN_CROP = 30;
const HANDLE_R   = 5;
const HANDLE_HIT = 9;

// ── Handle types ──────────────────────────────────────────────────────────────

type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSOR: Record<HandleKey, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
  se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
};

type DragState =
  | { mode: 'move';   startMX: number; startMY: number; startCX: number; startCY: number }
  | { mode: 'resize'; handle: HandleKey; anchor: { x: number; y: number }; startMX: number; startMY: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function getHandlePoints(crop: { x: number; y: number; size: number }): Record<HandleKey, { x: number; y: number }> {
  const { x, y, size } = crop;
  const cx = x + size / 2, cy = y + size / 2;
  return {
    nw: { x, y },           n: { x: cx, y },          ne: { x: x + size, y },
    w:  { x, y: cy },                                   e: { x: x + size, y: cy },
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

function getAnchor(handle: HandleKey, crop: { x: number; y: number; size: number }): { x: number; y: number } {
  const opposite: Record<HandleKey, HandleKey> = {
    nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e',
  };
  return getHandlePoints(crop)[opposite[handle]];
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  playlistId:        string;
  branchName:        string;
  currentArtworkUrl: string | null;
  onSaved:           (newUrl: string) => void;
  onClose:           () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PlaylistArtworkModal({ playlistId, branchName, currentArtworkUrl, onSaved, onClose }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imgUrl,    setImgUrl]    = useState<string | null>(null);
  const [nativeImg, setNativeImg] = useState<HTMLImageElement | null>(null);
  const [layout,    setLayout]    = useState({ drawX: 0, drawY: 0, drawW: DISPLAY, drawH: DISPLAY });
  const [crop,      setCrop]      = useState({ x: 0, y: 0, size: DISPLAY * 0.8 });
  const [cursor,    setCursor]    = useState('default');
  const dragRef = useRef<DragState | null>(null);

  const [message,       setMessage]       = useState('Set playlist artwork');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isFetchingUrl,  setIsFetchingUrl]  = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);
  const [saveErr,        setSaveErr]        = useState<string | null>(null);

  // ── Canvas draw ──────────────────────────────────────────────────────────────
  const draw = useCallback((img: HTMLImageElement, l: typeof layout, c: typeof crop) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, DISPLAY, DISPLAY);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, DISPLAY, DISPLAY);
    ctx.drawImage(img, l.drawX, l.drawY, l.drawW, l.drawH);

    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, 0, DISPLAY, c.y);
    ctx.fillRect(0, c.y + c.size, DISPLAY, DISPLAY - c.y - c.size);
    ctx.fillRect(0, c.y, c.x, c.size);
    ctx.fillRect(c.x + c.size, c.y, DISPLAY - c.x - c.size, c.size);

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x + 0.75, c.y + 0.75, c.size - 1.5, c.size - 1.5);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.75;
    for (let i = 1; i < 3; i++) {
      const px = c.x + (c.size / 3) * i, py = c.y + (c.size / 3) * i;
      ctx.beginPath(); ctx.moveTo(px, c.y); ctx.lineTo(px, c.y + c.size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x, py); ctx.lineTo(c.x + c.size, py); ctx.stroke();
    }

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

  // ── Load image ────────────────────────────────────────────────────────────────
  const loadImage = useCallback((src: string) => {
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
      draw(img, newLayout, newCrop);
    };
    img.src = src;
  }, [draw]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    loadImage(url);
  }, [imgUrl, loadImage]);

  // Load current artwork on mount if one exists
  useEffect(() => {
    if (currentArtworkUrl) loadImage(currentArtworkUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mouse interaction ─────────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!nativeImg) return;
    const { x: mx, y: my } = getCanvasPos(e);
    const handle = hitHandle(mx, my, crop);
    if (handle) {
      dragRef.current = { mode: 'resize', handle, anchor: getAnchor(handle, crop), startMX: mx, startMY: my };
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
      const h = hitHandle(mx, my, crop);
      if (h) setCursor(HANDLE_CURSOR[h]);
      else if (insideCrop(mx, my, crop)) setCursor('move');
      else setCursor('crosshair');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeImg, layout, crop]);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  // ── Build cropped blob ────────────────────────────────────────────────────────
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

  // ── Drop zone ──────────────────────────────────────────────────────────────────
  const loadImageFromUrl = useCallback(async (url: string) => {
    setIsFetchingUrl(true);
    setSaveErr(null);
    try {
      const bytes  = await invoke<number[]>('fetch_image_url', { url });
      const arr    = new Uint8Array(bytes);
      const objUrl = URL.createObjectURL(new Blob([arr]));
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      setImgUrl(objUrl);
      loadImage(objUrl);
    } catch (e) {
      setSaveErr(`Could not load image from URL: ${e}`);
    } finally {
      setIsFetchingUrl(false);
    }
  }, [imgUrl, loadImage]);

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingOver(true); };
  const handleDragLeave = () => { setIsDraggingOver(false); };
  const handleDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (file) { loadFile(file); return; }

    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) { loadFile(f); return; }
      }
    }

    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      const url = uriList.split(/\r?\n/).find(u => u.trim() && !u.startsWith('#') && u.startsWith('http'));
      if (url) { loadImageFromUrl(url.trim()); return; }
    }

    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const match = html.match(/src=["']([^"']+)["']/i);
      if (match?.[1]?.startsWith('http')) { loadImageFromUrl(match[1]); return; }
    }
  }, [loadFile, loadImageFromUrl]);

  // ── Save ───────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!nativeImg || isSaving || !message.trim()) return;
    setSaveErr(null);
    setIsSaving(true);
    try {
      const { arr, url } = await buildCroppedBlob();
      await invoke('playlist_set_artwork', {
        playlistId,
        branchName,
        imageBytes: arr,
        message: message.trim(),
      });
      onSaved(url);
    } catch (e) {
      setSaveErr(String(e));
      setIsSaving(false);
    }
  }, [nativeImg, isSaving, message, buildCroppedBlob, playlistId, branchName, onSaved]);

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 560, maxHeight: '90vh',
        background: 'var(--bg-2)', border: '1px solid var(--border-1)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border-0)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif" }}>
            Playlist Artwork
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', display: 'flex', padding: 4 }}
          >
            <IcoClose size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          <div style={{ display: 'flex', gap: 18, marginBottom: 18 }}>

            {/* Canvas */}
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

          {/* Commit message */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 5, fontFamily: "'Outfit', sans-serif" }}>
              Commit message
            </label>
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-3)', border: '1px solid var(--border-1)',
                borderRadius: 5, padding: '7px 10px',
                fontSize: 12, color: 'var(--text-0)',
                fontFamily: "'Outfit', sans-serif", outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderTop: '1px solid var(--border-0)', flexShrink: 0, gap: 12,
        }}>
          {saveErr
            ? <span style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace", flex: 1 }}>✗ {saveErr}</span>
            : <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>Output: {OUT_SIZE} × {OUT_SIZE} JPEG</span>
          }
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '7px 16px', borderRadius: 5, background: 'var(--bg-4)', border: '1px solid var(--border-2)', fontSize: 12, color: 'var(--text-1)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!nativeImg || isSaving || !message.trim()}
              style={{
                padding: '7px 20px', borderRadius: 5,
                background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                fontSize: 12, color: 'var(--accent-light)', fontFamily: "'Outfit', sans-serif", fontWeight: 600,
                cursor: (!nativeImg || isSaving || !message.trim()) ? 'not-allowed' : 'pointer',
                opacity: (!nativeImg || isSaving || !message.trim()) ? 0.5 : 1,
              }}
            >
              {isSaving ? 'Saving…' : 'Set Artwork'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
