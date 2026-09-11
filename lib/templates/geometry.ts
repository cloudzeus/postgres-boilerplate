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

/**
 * Arrow key → move by one step; with Shift → resize from the south-east corner. Unknown keys are a
 * no-op — including `toString`, `constructor` and friends: `key` is whatever the browser reports, so
 * the lookup is a `switch` rather than an object index that would inherit Object.prototype.
 *
 * Every no-op returns the SAME array reference — the unknown key, and equally the arrow that pushed
 * a box already flush against the page edge. Callers use that identity to skip committing an edit
 * that would write back the box they already have.
 */
export function nudgeBbox(b: Bbox, key: string, shift: boolean): Bbox {
  let dx = 0;
  let dy = 0;
  switch (key) {
    case 'ArrowLeft': dx = -NUDGE; break;
    case 'ArrowRight': dx = NUDGE; break;
    case 'ArrowUp': dy = -NUDGE; break;
    case 'ArrowDown': dy = NUDGE; break;
    default: return b;
  }
  const next = shift ? resizeBbox(b, 'se', dx, dy) : moveBbox(b, dx, dy);
  return next.every((n, i) => n === b[i]) ? b : next;
}

/**
 * A box the model drew INSIDE a crop, expressed back in page coordinates. `cropBbox` must be the
 * box that was actually extracted (i.e. already padded, if `prepareCrop` was given a pad) — the
 * crop's own 0–1 space starts at its top-left corner and spans its width and height.
 *
 * `prepareCrop` resizes with `fit: 'inside'`, which keeps the aspect ratio, so the mapping stays a
 * plain linear one whatever the model's image was scaled to.
 */
export function cropBoxToPage(cropBbox: Bbox, boxInCrop: Bbox | null): Bbox | null {
  if (!boxInCrop) return null;
  const [cx, cy, cw, ch] = cropBbox;
  const [x, y, w, h] = boxInCrop;
  return clampBbox([cx + x * cw, cy + y * ch, w * cw, h * ch]);
}
