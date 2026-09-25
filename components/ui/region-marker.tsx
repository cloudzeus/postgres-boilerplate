'use client';
import * as React from 'react';
import { useMarquee, type NormBox } from '@/app/admin/ocr/[id]/use-marquee';
import { clampBbox, moveBbox, nudgeBbox, resizeBbox, type Handle } from '@/lib/templates/geometry';
import type { Bbox } from '@/lib/templates/schema';

export type SavedRegion = { bbox: [number, number, number, number]; color?: string; active?: boolean; label?: string };

type Props = {
  pageImageUrl: (page: number) => string;
  pageCount?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  savedRegions?: SavedRegion[];
  /**
   * Hovering a saved box reports its index in `savedRegions` (and `null` on leave), so a caller can
   * light up the matching row in its own list. Saved boxes stay click-through until this is given —
   * without it they must never swallow the pointer, or marking a new region on top of an old one
   * would be impossible.
   */
  onRegionHover?: (index: number | null) => void;
  isMarking: boolean;
  onRegionComplete: (box: NormBox, page: number) => void;
  onError?: () => void;
  /** Show the built-in ← page N/M → row. Set false when the parent renders its own nav. */
  showNav?: boolean;
  /** Alt text for the page image. Defaults to «Δείγμα εγγράφου, σελίδα N». */
  pageLabel?: string;
  /**
   * Let the user drag saved boxes around and resize them by their 8 handles (spec §16). Off by
   * default: without it the component renders exactly as before. Ignored while `isMarking`, so
   * drawing a new region always wins over editing an old one.
   */
  editable?: boolean;
  /**
   * Index of the region that shows its handles; the others reveal theirs on hover. This is the
   * SELECTION, not the hover: a box the pointer merely crosses must not arm its handles, or the
   * first press would resize a region the user never picked.
   */
  selectedIndex?: number | null;
  /** A click that did not drag, or `Escape` (→ `null`). Hover never reports here — see `onRegionHover`. */
  onRegionSelect?: (index: number | null) => void;
  /**
   * A finished edit: fires on pointer-up and on every keyboard nudge, never mid-drag — the live
   * box is kept in local state so the parent only ever sees committed geometry.
   */
  onRegionChange?: (index: number, bbox: Bbox) => void;
  className?: string;
};

/** The 8 resize handles: offset within the box (%) and the cursor that advertises the axis. */
const HANDLES: { h: Handle; x: number; y: number; cursor: string }[] = [
  { h: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { h: 'n', x: 50, y: 0, cursor: 'ns-resize' },
  { h: 'ne', x: 100, y: 0, cursor: 'nesw-resize' },
  { h: 'e', x: 100, y: 50, cursor: 'ew-resize' },
  { h: 'se', x: 100, y: 100, cursor: 'nwse-resize' },
  { h: 's', x: 50, y: 100, cursor: 'ns-resize' },
  { h: 'sw', x: 0, y: 100, cursor: 'nesw-resize' },
  { h: 'w', x: 0, y: 50, cursor: 'ew-resize' },
];

type DragSession = {
  index: number;
  handle: Handle | null;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
  origin: Bbox;
  moved: boolean;
};

export function RegionMarker({
  pageImageUrl, pageCount = 1, page = 0, onPageChange, savedRegions = [], onRegionHover, isMarking, onRegionComplete, onError, showNav = true, className, pageLabel,
  editable = false, selectedIndex = null, onRegionSelect, onRegionChange,
}: Props) {
  const url = pageImageUrl(page);
  const [objUrl, setObjUrl] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Fetch the page image ourselves (instead of <img src>) so that on a non-OK
  // response we can read the JSON error body and show the real reason.
  React.useEffect(() => {
    let alive = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          // 422 is the one non-OK the user can act on — the document simply has no such page (the
          // marker can be paged past the end). It says so in words; every other status keeps the
          // HTTP code and a slice of the body, which is diagnostics, not a message.
          const msg = res.status === 422
            ? 'Το έγγραφο δεν έχει αυτή τη σελίδα.'
            : `HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 200)}`;
          if (!alive) return;
          setErrMsg(msg);
          setObjUrl(null);
          setLoading(false);
          onError?.();
          return;
        }
        const blob = await res.blob();
        if (!alive) return;
        createdUrl = URL.createObjectURL(blob);
        setObjUrl(createdUrl);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErrMsg(`network: ${e?.message ?? e}`);
        setObjUrl(null);
        setLoading(false);
        onError?.();
      }
    })();
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, onError]);

  const handleComplete = React.useCallback((b: NormBox) => onRegionComplete(b, page), [onRegionComplete, page]);
  const { ref, box, active, handlers } = useMarquee(handleComplete);

  const interactive = editable && !isMarking;
  // The in-flight drag lives in a ref (no re-render per pointermove decision) while the box it
  // produces lives in state, so only this component repaints until the edit is committed.
  const drag = React.useRef<DragSession | null>(null);
  const [live, setLive] = React.useState<{ index: number; bbox: Bbox } | null>(null);
  // On-screen width of the page image, so a normalized box can be judged in pixels. Measured when
  // the image lands and again at every drag start — enough to keep up with a resized window without
  // paying for a ResizeObserver on a canvas nobody resizes mid-edit.
  const [pageWidth, setPageWidth] = React.useState(0);
  React.useEffect(() => {
    if (!objUrl) return;
    setPageWidth(ref.current?.getBoundingClientRect().width ?? 0);
  }, [objUrl, ref]);

  const nextBox = React.useCallback((d: DragSession, clientX: number, clientY: number): Bbox => {
    const dx = (clientX - d.clientX) / d.width;
    const dy = (clientY - d.clientY) / d.height;
    return d.handle ? resizeBbox(d.origin, d.handle, dx, dy) : moveBbox(d.origin, dx, dy);
  }, []);

  const onBoxPointerDown = React.useCallback((i: number, bbox: Bbox, e: React.PointerEvent) => {
    // Only the primary button drags. A right-click must reach the context menu, and a middle-click
    // that started a drag would never get its pointerup (the browser eats it) — leaving the session
    // stuck and every later pointermove silently editing the box.
    if (e.button !== 0) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    setPageWidth(rect.width);
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    // preventDefault above kills the browser's own focus-on-click, which the arrow-key nudge needs.
    (e.currentTarget as HTMLElement).focus?.();
    const handle = ((e.target as HTMLElement).dataset?.handle ?? null) as Handle | null;
    drag.current = { index: i, handle, clientX: e.clientX, clientY: e.clientY, width: rect.width, height: rect.height, origin: bbox, moved: false };
    setLive({ index: i, bbox });
  }, [ref]);

  const onBoxPointerMove = React.useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // A couple of pixels of jitter must still read as a click, not as a (no-op) move.
    if (!d.moved && Math.abs(e.clientX - d.clientX) + Math.abs(e.clientY - d.clientY) <= 2) return;
    d.moved = true;
    setLive({ index: d.index, bbox: nextBox(d, e.clientX, e.clientY) });
  }, [nextBox]);

  const onBoxPointerUp = React.useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setLive(null);
    if (d.moved) onRegionChange?.(d.index, clampBbox(nextBox(d, e.clientX, e.clientY)));
    else onRegionSelect?.(d.index);
  }, [nextBox, onRegionChange, onRegionSelect]);

  // Both a cancelled pointer and a LOST capture (the browser hands the pointer to someone else — a
  // scroll gesture, a dragged-away touch, an alert) end the session without a pointerup, so the live
  // box has to be dropped here or the next pointermove would resume an edit the user abandoned.
  const onBoxPointerCancel = React.useCallback(() => {
    drag.current = null;
    setLive(null);
  }, []);

  const onBoxKeyDown = React.useCallback((i: number, bbox: Bbox, e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
      onRegionSelect?.(null);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRegionSelect?.(i);
      return;
    }
    const next = nudgeBbox(bbox, e.key, e.shiftKey);
    // Same reference = nothing to commit: either not an arrow key at all, or a box already flush
    // against the page edge that the clamp put back where it was. Either way, no `onRegionChange`.
    if (next === bbox) return;
    e.preventDefault();
    onRegionChange?.(i, next);
  }, [onRegionChange, onRegionSelect]);

  return (
    <div className={className}>
      {showNav && pageCount > 1 && (
        <div className="mb-2 flex items-center gap-2 text-[length:var(--fs-12)]">
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page <= 0} onClick={() => onPageChange?.(page - 1)}>←</button>
          <span>Σελίδα {page + 1} / {pageCount}</span>
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page >= pageCount - 1} onClick={() => onPageChange?.(page + 1)}>→</button>
        </div>
      )}
      {errMsg ? (
        <div className="space-y-1 rounded border border-dg-red-500/40 bg-dg-red-500/5 p-3 text-[length:var(--fs-12)] text-dg-red-600 dark:text-dg-red-400">
          <p className="font-semibold">Δεν ήταν δυνατή η προβολή της εικόνας.</p>
          <p className="break-all font-mono text-[length:var(--fs-11)] opacity-80">{errMsg}</p>
        </div>
      ) : loading ? (
        <div className="p-3 text-[length:var(--fs-12)] text-muted-foreground">Φόρτωση…</div>
      ) : objUrl ? (
        <div ref={ref} {...(isMarking ? handlers : {})} className="relative w-full select-none"
          style={{
            cursor: isMarking ? 'crosshair' : 'default',
            // `touch-action: none` belongs on whatever actually swallows the gesture: while marking
            // that is the whole canvas, but in edit mode only the boxes themselves (below) — killing
            // the page scroll over a full-page document image would trap a touch user on it.
            touchAction: isMarking ? 'none' : undefined,
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={objUrl} alt={pageLabel ?? `Δείγμα εγγράφου, σελίδα ${page + 1}`} className="block w-full" draggable={false} />
          {isMarking && active && box && (
            <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
          )}
          {!active && savedRegions.map((r, i) => {
            const c = r.color ?? '#10b981';
            const bb = live && live.index === i ? live.bbox : r.bbox;
            // A box at the very top of the page has no room above it for its label — hang it under
            // the box instead, where it is still readable rather than clipped off the image.
            const labelBelow = bb[1] < 0.04;
            // A box only a few pixels wide has no room for 8 handles — they would cover the region
            // entirely and every grab would land on a handle instead of the box. Move it, or nudge it
            // wider with Shift+arrow, and they come back.
            const roomForHandles = pageWidth === 0 || bb[2] * pageWidth >= 16;
            return (
              <div key={i} className={`absolute overflow-visible ${onRegionHover || interactive ? '' : 'pointer-events-none'}${interactive ? ' group cursor-move outline-none' : ''}`}
                onMouseEnter={onRegionHover ? () => onRegionHover(i) : undefined}
                onMouseLeave={onRegionHover ? () => onRegionHover(null) : undefined}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `Περιοχή ${r.label ?? i + 1}` : undefined}
                aria-pressed={interactive ? selectedIndex === i : undefined}
                onPointerDown={interactive ? (e) => onBoxPointerDown(i, r.bbox, e) : undefined}
                onPointerMove={interactive ? onBoxPointerMove : undefined}
                onPointerUp={interactive ? onBoxPointerUp : undefined}
                onPointerCancel={interactive ? onBoxPointerCancel : undefined}
                onLostPointerCapture={interactive ? onBoxPointerCancel : undefined}
                onKeyDown={interactive ? (e) => onBoxKeyDown(i, r.bbox, e) : undefined}
                style={{
                  left: `${bb[0] * 100}%`, top: `${bb[1] * 100}%`, width: `${bb[2] * 100}%`, height: `${bb[3] * 100}%`,
                  border: `${r.active ? 3 : 2}px solid ${c}`,
                  background: c + (r.active ? '33' : '1A'),
                  boxShadow: r.active ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : undefined,
                  touchAction: interactive ? 'none' : undefined,
                }}>
                {r.label && (
                  <span className={`pointer-events-none absolute left-0 rounded-sm px-1 text-[length:var(--fs-10)] font-medium text-white ${labelBelow ? 'top-full' : '-top-4'}`}
                    style={{ background: c }}>{r.label}</span>
                )}
                {interactive && roomForHandles && HANDLES.map((hd) => (
                  // 12px of paint with an invisible 4px skirt (`after:-inset-1`) → a 20px target, which
                  // a finger can hit without the handle itself covering a small region.
                  // Only the SELECTED box may be resized: an unselected one reveals its handles on
                  // hover as an affordance, but they stay click-through so the first press moves or
                  // selects the box, never resizes it by accident.
                  <span key={hd.h} data-handle={hd.h} aria-hidden
                    className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 bg-white after:absolute after:-inset-1 after:content-[''] ${selectedIndex === i ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100'}`}
                    style={{ left: `${hd.x}%`, top: `${hd.y}%`, borderColor: c, cursor: hd.cursor, touchAction: 'none' }} />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
