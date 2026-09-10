// lib/templates/geometry.ts — PURE bbox editing math for the region canvas (spec §16). bbox = [x, y, w, h] normalized 0–1.
import type { Bbox } from './schema';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Smallest box the user can drag a handle down to — below this a region is unreadable and unclickable. */
export const MIN_SIZE = 0.01;
/** One arrow-key step (0.5% of the page). Shift+arrow resizes by the same amount. */
export const NUDGE = 0.005;

// Normalized coordinates carry float noise after every drag; 3 decimals is ~1px on a 1000px page.
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Keep the box inside the page and at least MIN_SIZE in both directions. */
export function clampBbox(b: Bbox): Bbox {
  let [x, y, w, h] = b;
  w = Math.min(1, Math.max(MIN_SIZE, w));
  h = Math.min(1, Math.max(MIN_SIZE, h));
  x = Math.min(1 - w, Math.max(0, x));
  y = Math.min(1 - h, Math.max(0, y));
  return [r3(x), r3(y), r3(w), r3(h)];
}

/** Translate by (dx, dy) without changing the size; the box stops at the page edges. */
export function moveBbox(b: Bbox, dx: number, dy: number): Bbox {
  return clampBbox([b[0] + dx, b[1] + dy, b[2], b[3]]);
}

/** Drag a handle by (dx, dy). Opposite edges stay put; the box never inverts or drops below MIN_SIZE. */
export function resizeBbox(b: Bbox, handle: Handle, dx: number, dy: number): Bbox {
  const [x, y, w, h] = b;
  const x2 = x + w, y2 = y + h;
  let nx = x, ny = y, nx2 = x2, ny2 = y2;
  if (handle.includes('e')) nx2 = Math.max(x + MIN_SIZE, Math.min(1, x2 + dx));
  if (handle.includes('w')) nx = Math.min(x2 - MIN_SIZE, Math.max(0, x + dx));
  if (handle.includes('s')) ny2 = Math.max(y + MIN_SIZE, Math.min(1, y2 + dy));
  if (handle.includes('n')) ny = Math.min(y2 - MIN_SIZE, Math.max(0, y + dy));
  return clampBbox([nx, ny, nx2 - nx, ny2 - ny]);
}

/** Arrow key → move by one step; with Shift → resize from the south-east corner. Unknown keys are a no-op. */
export function nudgeBbox(b: Bbox, key: string, shift: boolean): Bbox {
  const d = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[key as 'ArrowLeft'];
  if (!d) return b;
  return shift ? resizeBbox(b, 'se', d[0], d[1]) : moveBbox(b, d[0], d[1]);
}
