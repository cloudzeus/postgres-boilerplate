// lib/templates/adaptive.ts — PURE. The radius around the last successful read (spec §17.2).
//
// A region is drawn ONCE, on one sample. The next document from the same issuer prints the value a
// few millimetres lower and the tight box reads nothing at all. Instead of failing, the extractor
// takes a second look in a WIDER box around the position the field was actually found at last time
// (`TemplateField.lastGood`), and asks the model to locate the label inside it.
//
// `lastGood` is a moving average, not the last box: one crooked scan must not drag the search area
// off the field for every document that follows. It is only ever updated from values a human either
// confirmed or declined to correct — learning from a wrong reading would teach the wrong place.
import { clampBbox } from './geometry';
import { isValidBbox, type Bbox, type LastGood, type Region } from './schema';

export type { LastGood };

/**
 * Confidence of a value only the widened read could find. Below `RETRY_CONFIDENCE` (0.6) on purpose:
 * the box was not the one the designer drew, so the run is flagged for review either way.
 */
export const ADAPTIVE_CONFIDENCE = 0.5;

/** How much wider the second look is, as a fraction of the box's own width/height on EACH side. */
export const WIDEN_FACTOR = 0.15;

/** Upper bound on the moving-average weight: past 10 readings a new one still moves the box by 1/11. */
export const LAST_GOOD_MAX_N = 10;

/** Grow a box by `factor` of its own width/height on every side, clamped to the page. */
export function widenBbox(bbox: Bbox, factor: number = WIDEN_FACTOR): Bbox {
  const [x, y, w, h] = bbox;
  if (!Number.isFinite(factor) || factor <= 0) return clampBbox(bbox);
  const dx = w * factor;
  const dy = h * factor;
  return clampBbox([x - dx, y - dy, w + 2 * dx, h + 2 * dy]);
}

type FieldLike = { region: Region | null; lastGood?: LastGood | null };

/**
 * The boxes to try, in order: the template's own region first (the cheap, exact read the designer
 * drew), then ONE widened box — around `lastGood` when the field has drifted, otherwise around the
 * region itself. A field with no region has nothing to search.
 */
export function searchBoxes(field: FieldLike): Bbox[] {
  if (!field.region) return [];
  const base = field.region.bbox;
  const lg = field.lastGood;
  const drifted = lg && !sameBbox(lg.bbox, base);
  return [base, widenBbox(drifted ? lg!.bbox : base)];
}

/**
 * `searchBoxes`'s widened box together with the page it belongs to — `lastGood` can have been
 * learned on another page than the one the region names, and a crop needs both as a unit.
 */
export function adaptiveRegion(field: FieldLike): Region | null {
  const boxes = searchBoxes(field);
  if (boxes.length < 2) return null;
  const lg = field.lastGood;
  const drifted = lg && !sameBbox(lg.bbox, field.region!.bbox);
  return { page: drifted ? lg!.page : field.region!.page, bbox: boxes[1] };
}

const sameBbox = (a: Bbox, b: Bbox) => a.every((n, i) => n === b[i]);

/**
 * Fold one more successful reading into the average. The new box counts for 1 against the `n`
 * readings already in there, so the search area converges on where the value really lives and a
 * single outlier moves it very little.
 */
export function updateLastGood(prev: LastGood | null, page: number, bbox: Bbox, at: string): LastGood {
  if (!prev) return { page, bbox: clampBbox(bbox), at, n: 1 };
  // A different PAGE is a different piece of paper: averaging the box found on page 3 with the boxes
  // learned on page 1 produces coordinates that describe neither, and the widened read would then
  // search a place the value has never been. The move starts the average over instead.
  if (prev.page !== page) return { page, bbox: clampBbox(bbox), at, n: 1 };
  const n = Math.min(Math.max(1, prev.n), LAST_GOOD_MAX_N);
  const avg = prev.bbox.map((v, i) => (v * n + bbox[i]) / (n + 1)) as Bbox;
  return { page, bbox: clampBbox(avg), at, n: Math.min(prev.n + 1, LAST_GOOD_MAX_N) };
}

/** Read `TemplateField.lastGood` back out of the JSON column; `null` for anything unusable. */
export function toLastGood(raw: unknown): LastGood | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isValidBbox(o.bbox)) return null;
  const page = typeof o.page === 'number' && Number.isInteger(o.page) && o.page >= 0 ? o.page : 0;
  const n = typeof o.n === 'number' && o.n >= 1 ? Math.min(Math.floor(o.n), LAST_GOOD_MAX_N) : 1;
  return { page, bbox: o.bbox, at: typeof o.at === 'string' ? o.at : '', n };
}

/**
 * What `lastGood` must become when a region is written by hand — the designer drawing a box, or
 * «Αποθήκευση στο πρότυπο» saving the box a re-read used. `undefined` = leave the stored value
 * alone (the region did not move), `null` = clear it (the region is gone).
 *
 * A moved box makes everything learned so far a statement about the OLD position: keeping it would
 * send the widened read straight back to the place the user has just corrected. The new box starts
 * the average again at `n = 1`, so the very next reading can still pull it.
 */
export function lastGoodForRegion(prev: Region | null, next: Region | null, at: string): LastGood | null | undefined {
  const same = prev == null && next == null
    ? true
    : prev != null && next != null && prev.page === next.page && sameBbox(prev.bbox, next.bbox);
  if (same) return undefined;
  return next ? { page: next.page, bbox: next.bbox, at, n: 1 } : null;
}
