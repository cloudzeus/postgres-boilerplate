'use client';
import { useCallback, useRef, useState } from 'react';

export interface NormBox { x: number; y: number; w: number; h: number; }

/**
 * Drag-to-select over a ref'd element. Returns the live box (normalized 0..1)
 * and pointer handlers. `onComplete` fires with the final box on pointer up.
 */
export function useMarquee(onComplete: (box: NormBox) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<NormBox | null>(null);
  const [active, setActive] = useState(false);

  const rel = useCallback((e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!ref.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = rel(e); setActive(true); setBox({ ...start.current, w: 0, h: 0 });
  }, [rel]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active || !start.current) return;
    const p = rel(e);
    setBox({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y),
      w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
  }, [active, rel]);

  const onPointerUp = useCallback(() => {
    setActive(false);
    if (box && box.w > 0.005 && box.h > 0.005) onComplete(box);
    start.current = null; setBox(null);
  }, [box, onComplete]);

  return { ref, box, active, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
