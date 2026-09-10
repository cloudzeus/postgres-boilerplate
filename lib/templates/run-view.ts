// lib/templates/run-view.ts — ISOMORPHIC, PURE. The arithmetic and formatting the run card and the
// OCR list do to a run before painting it. Lives here, not in the components, so it can be tested
// without a DOM and so the picker and the card cannot disagree about what "matches this ΑΦΜ" means.
import { normalizeVat, slugKey, uniqueKey, type Bbox, type ColumnDef, type FieldValue, type Region, type RunStatus, type TemplateValueType } from './schema';

const EMPTY = '—';

/**
 * Greek-formatted display of a coerced value, by the FIELD's declared type: money always shows its
 * two decimals (`12` → «12,00»), a plain number keeps up to four and no trailing zeros. Arrays report
 * their size — the rows themselves expand below the row.
 */
export function formatValue(v: FieldValue['value'], valueType: TemplateValueType): string {
  if (v == null || v === '') return EMPTY;
  if (typeof v === 'number') {
    return valueType === 'CURRENCY'
      ? v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toLocaleString('el-GR', { maximumFractionDigits: 4 });
  }
  if (Array.isArray(v)) return `${v.length} γραμμ${v.length === 1 ? 'ή' : 'ές'}`;
  return String(v);
}

/**
 * What the inline editor starts on, and therefore what "unchanged" means when it commits. One
 * expression for both, so a value whose `raw` differs from its coerced form cannot save a no-op.
 */
export function editSeed(v: FieldValue | undefined): string {
  return v?.raw ?? String(v?.value ?? '');
}

/**
 * How many pages the marker may page through: one past the deepest page any value came from, but
 * never fewer than `minPages`. The floor is the template's own sample: «Νέο πεδίο» marks a box on a
 * page the run read NOTHING from, and without it those pages are unreachable. A page the document
 * does not actually have answers 422 on its image, which the marker already renders as "no page".
 */
export function pageCountOf(values: Record<string, FieldValue>, minPages = 0): number {
  let max = 0;
  for (const v of Object.values(values)) if (v?.page != null && v.page > max) max = v.page;
  return Math.max(max + 1, minPages);
}

/** «Περιγραφή, Ποσότητα, Αξία» → three columns with unique slugged keys. Empty entries drop out. */
export function parseColumns(text: string): ColumnDef[] {
  const cols: ColumnDef[] = [];
  for (const raw of text.split(',')) {
    const label = raw.trim();
    if (!label) continue;
    cols.push({ key: uniqueKey(slugKey(label), cols.map((c) => c.key)), label, valueType: 'TEXT' });
  }
  return cols;
}

/** One box on the page image, without the bits that depend on what is focused or how it is labelled. */
export type RunRegionBox = { bbox: Bbox; color?: string };

/**
 * The boxes of ONE page of a run, and the field key behind each one, in the same order — the marker
 * addresses regions by index, the list by key, and this is the only place the two are tied together.
 *
 * A box the user just moved or resized (`pending`) WINS over the one the run was executed with, until
 * «Επανάγνωση» sends it to the server and the run comes back carrying it. A pending box also carries
 * its own page: an adjustment that moved a field to another page follows it there.
 */
export function buildRunRegions(
  values: Record<string, FieldValue>,
  pending: Record<string, Region>,
  page: number,
): { regions: RunRegionBox[]; keys: string[] } {
  const regions: RunRegionBox[] = [];
  const keys: string[] = [];
  for (const [key, v] of Object.entries(values)) {
    const adjusted = pending[key];
    const bbox = adjusted?.bbox ?? v?.bbox;
    if (!bbox || (adjusted?.page ?? v?.page ?? 0) !== page) continue;
    keys.push(key);
    regions.push({ bbox, color: v?.color });
  }
  return { regions, keys };
}

/** Field key → the index the marker knows that box by (`null` = not on this page / no box at all). */
export function regionIndexOf(keys: string[], key: string | null): number | null {
  if (!key) return null;
  const i = keys.indexOf(key);
  return i < 0 ? null : i;
}

/** The marker's index → the field key it belongs to (`null` for "nothing", and for a stale index). */
export function regionKeyAt(keys: string[], index: number | null): string | null {
  return index == null ? null : keys[index] ?? null;
}

/** The part of a template the ΑΦΜ match and the default selection need. */
export type TemplateChoice = { id: string; status: 'DRAFT' | 'ACTIVE'; vatNumber: string | null };

/** Is this the template the runner would have picked for that issuer by itself? */
export function matchesVat(t: TemplateChoice, issuerVat: string | null): boolean {
  const vat = normalizeVat(issuerVat);
  return vat != null && normalizeVat(t.vatNumber) === vat;
}

/**
 * What the picker should start on: the template of the newest run, else the first ACTIVE template
 * for the issuer ΑΦΜ, else the first ΑΦΜ match of any status, else ''.
 */
export function defaultTemplateId(templates: TemplateChoice[], issuerVat: string | null, lastRunTemplateId?: string | null): string {
  if (lastRunTemplateId && templates.some((t) => t.id === lastRunTemplateId)) return lastRunTemplateId;
  const mine = templates.filter((t) => matchesVat(t, issuerVat));
  return mine.find((t) => t.status === 'ACTIVE')?.id ?? mine[0]?.id ?? '';
}

/**
 * How loudly a run status asks for attention. Sorting the OCR list's «Πρότυπο» column by it puts the
 * documents somebody has to deal with on top, instead of ordering five Greek words alphabetically.
 */
const SEVERITY: Record<RunStatus, number> = { BLOCKED: 5, FAILED: 4, REVIEW: 3, EXTRACTED: 2, POSTED: 1 };
export function runSeverity(status: RunStatus | null | undefined): number {
  return status ? SEVERITY[status] ?? 0 : 0;
}
