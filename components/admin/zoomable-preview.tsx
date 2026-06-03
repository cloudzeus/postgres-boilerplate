'use client';

import * as React from 'react';
import { FiZoomIn, FiMaximize } from 'react-icons/fi';

/**
 * Preview pane with wheel-to-zoom and drag-to-pan, για αντιπαραβολή του πρωτότυπου
 * με τα σκαναρισμένα στοιχεία.
 *
 * Works for both images and PDFs. For PDFs the <iframe> gets `pointer-events: none`
 * so the wheel/drag reaches our wrapper (the native PDF scroll is traded for our own
 * zoom+pan — full interaction is still available via the «Άνοιγμα» link).
 */
export function ZoomablePreview({
  src, alt, className, fallbackHref,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Shown if the high-res raster fails to load (e.g. the original PDF). */
  fallbackHref?: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [t, setT] = React.useState({ s: 1, x: 0, y: 0 });
  const [errored, setErrored] = React.useState(false);
  const drag = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  // Native non-passive wheel listener so we can preventDefault (React's onWheel is passive).
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setT((prev) => {
        const ns = clamp(prev.s * (1 + (-e.deltaY * 0.0016)), 1, 6);
        if (ns === prev.s) return prev;
        const ratio = ns / prev.s;
        let nx = cx - ratio * (cx - prev.x);
        let ny = cy - ratio * (cy - prev.y);
        if (ns === 1) { nx = 0; ny = 0; }
        return { s: ns, x: nx, y: ny };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (t.s <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: t.x, oy: t.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setT((p) => ({ ...p, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  };
  const endDrag = () => { drag.current = null; };
  const reset = () => setT({ s: 1, x: 0, y: 0 });

  const transform = `translate(${t.x}px, ${t.y}px) scale(${t.s})`;
  const zoomed = t.s > 1;

  return (
    <div
      ref={wrapRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onDoubleClick={reset}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        cursor: zoomed ? (drag.current ? 'grabbing' : 'grab') : 'zoom-in',
        touchAction: 'none',
      }}
      title="Κύλισε για zoom · σύρε για μετακίνηση · διπλό κλικ για επαναφορά"
    >
      {errored ? (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
          <span>Δεν ήταν δυνατή η προεπισκόπηση.</span>
          {fallbackHref && (
            <a href={fallbackHref} target="_blank" rel="noreferrer" className="font-semibold text-sisyphus-600 hover:underline">
              Άνοιγμα πρωτότυπου
            </a>
          )}
        </div>
      ) : (
        <div style={{ width: '100%', height: '100%', transform, transformOrigin: '0 0' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setErrored(true)}
            className="size-full object-contain select-none"
          />
        </div>
      )}

      {/* Zoom indicator / reset */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
        {zoomed && (
          <button
            type="button"
            onClick={reset}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm hover:bg-black/80"
            title="Επαναφορά zoom"
          >
            <FiMaximize className="size-3" /> {Math.round(t.s * 100)}%
          </button>
        )}
        {!zoomed && (
          <span className="inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <FiZoomIn className="size-3" /> Κύλισε για zoom
          </span>
        )}
      </div>
    </div>
  );
}
