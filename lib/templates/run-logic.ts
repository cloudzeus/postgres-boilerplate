// lib/templates/run-logic.ts — PURE pieces of a template run (spec §15.3). No I/O.
import { getPath, legacyKeyToPath, setPath, type DocumentJson } from '@/lib/ocr/canonical';
import { coerceValue } from './coerce';
import { documentKeyInfo, type FieldDef, type FieldValue, type MappingTarget, type RunStatus, type TemplateMode } from './schema';

/** How badly one field is flagged. `blocked` implies `review` — a blocked field always wants eyes too. */
export type FieldFlag = 'review' | 'blocked';
/**
 * What a run has to say about itself. `review`/`blocked` are the human-readable reasons (the card
 * lists them); `fields` is the same verdict keyed by FIELD KEY, so the UI can colour a row without
 * fishing the label back out of the Greek prose.
 */
export type RunFlags = { review: string[]; blocked: string[]; fields: Record<string, FieldFlag> };
export type MappingLike = { name: string; target: MappingTarget; isDefault: boolean };
export type RunDecision = 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POST';

/**
 * SET_FIELD actions that target a template field: coerce by the field's type and mark the value
 * as `rule` (a run's own audit trail — 'manual' means a human typed it).
 * Coordinates: an existing value keeps the box it was read from, otherwise the field's own region
 * is used. `page` and `bbox` are resolved as a UNIT, so a value never mixes one box's page with
 * another box's rectangle.
 */
export function applySetFields(values: Record<string, FieldValue>, fields: FieldDef[], sets: { fieldKey?: string; value: string }[]): Record<string, FieldValue> {
  const out = { ...values };
  for (const s of sets) {
    if (!s.fieldKey) continue;
    const f = fields.find((x) => x.key === s.fieldKey);
    if (!f) continue;
    const prev = out[f.key];
    const loc = prev && (prev.bbox || prev.page != null) ? prev : f.region;
    out[f.key] = { raw: s.value, value: coerceValue(s.value, f.valueType), confidence: 1, source: 'rule', page: loc?.page ?? null, bbox: loc?.bbox ?? null, color: f.color };
  }
  return out;
}

const isBlank = (v: FieldValue['value']) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export function requiredMissing(fields: FieldDef[], values: Record<string, FieldValue>): FieldDef[] {
  return fields.filter((f) => f.required && isBlank(values[f.key]?.value ?? null));
}

/** The INVOICE mapping that drives the projection: the switched one if it exists and is INVOICE, else the default, else the first. */
export function pickMapping<M extends MappingLike>(mappings: M[], switched: string | null): M | null {
  const invoice = mappings.filter((m) => m.target === 'INVOICE');
  if (switched) { const hit = invoice.find((m) => m.name === switched); if (hit) return hit; }
  return invoice.find((m) => m.isDefault) ?? invoice[0] ?? null;
}

/** True when a SWITCH_MAPPING rule named a mapping that does not exist — `pickMapping` silently fell back. */
export function mappingFellBack(mappings: MappingLike[], switched: string | null): boolean {
  if (!switched) return false;
  return !mappings.some((m) => m.target === 'INVOICE' && m.name === switched);
}

/** Mode → what the run becomes. `blocked` only decides here for AUTO; posting itself is gated by `canPost`. */
export function decideOutcome(mode: TemplateMode, flags: Pick<RunFlags, 'blocked'>): RunDecision {
  if (mode === 'MANUAL') return 'EXTRACTED';
  if (mode === 'SEMI_AUTO') return 'REVIEW';
  return flags.blocked.length ? 'BLOCKED' : 'POST';
}

/**
 * Whether these flags allow a posting, in any mode. The runner asks before posting itself, and the
 * manual post route asks with the flags the last run left on the document — so a BLOCK_POSTING reason
 * also stops a human pressing «Έγκριση → ανάρτηση». It is only ever as current as those flags: a
 * document whose template was never re-run carries whatever the last run concluded.
 */
export function canPost(mode: TemplateMode, flags: Pick<RunFlags, 'blocked'>): boolean {
  void mode; // deliberately mode-independent; the parameter keeps the call site readable as a policy check
  return flags.blocked.length === 0;
}

/** Οι μεταβλητές `$…` που βλέπουν οι κανόνες: ό,τι ξέρει το έγγραφο, όχι το πρότυπο. */
export function extrasFrom(document: DocumentJson, itemsCount: number, pageCount: number): Record<string, number | string | null> {
  return { $total: document.totals.total, $itemsCount: itemsCount, $pageCount: pageCount };
}

/**
 * SET_FIELD actions that target a document path, applied after the projection. A `lines.*` path
 * cannot be set as a whole — ignored. Returns the NEW document, or null when nothing was written:
 * a typed path whose value does not coerce (e.g. `totals.total` ← "abc") is LEFT UNTOUCHED rather
 * than overwritten with a string the rest of the app would read as a number.
 *
 * Παλιά `invoiceKey` (`totalAmount`, `customFields.po`) περνούν μέσα από το `documentKeyInfo`.
 */
export function setDocumentPath(document: DocumentJson, key: string, value: string): DocumentJson | null {
  const info = documentKeyInfo(key);
  if (!info || info.isLine) return null;
  if (info.valueType === 'TEXT') return setPath(document, info.key, value);
  const coerced = coerceValue(value, info.valueType);
  if (coerced == null) return null;
  return setPath(document, info.key, coerced);
}

// ─── Cross-checking the template against the base OCR ──────────────────────
// The template wins the projection — it was drawn by a human on this exact form. But the base OCR
// read the same document independently, and where the two disagree on an amount, a number or the
// date, one of them is wrong and nobody can tell which from the outside. So: keep the template's
// value, and say out loud that they disagree.

/** Header paths worth cross-checking — the ones a wrong reading actually costs money on. */
const CROSS_CHECK_PATHS = new Set(['totals.total', 'totals.net', 'totals.vatAmount', 'type.number', 'date']);
/** Paths compared as numbers; the rest are compared as normalised text. */
const CROSS_CHECK_NUMERIC = new Set(['totals.total', 'totals.net', 'totals.vatAmount']);
/** Two amounts within half a cent of each other are the same amount. */
const AMOUNT_TOLERANCE = 0.005;

const normText = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const asAmount = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const c = coerceValue(v, 'CURRENCY');
  return typeof c === 'number' ? c : null;
};

/** True when the two readings genuinely disagree about `path`. */
function disagrees(path: string, mine: unknown, theirs: unknown): boolean {
  if (CROSS_CHECK_NUMERIC.has(path)) {
    const a = asAmount(mine); const b = asAmount(theirs);
    // A side that will not parse as a number cannot be compared numerically — fall back to text
    // rather than declaring a mismatch nobody can act on.
    if (a != null && b != null) return Math.abs(a - b) > AMOUNT_TOLERANCE;
  }
  if (path === 'date') {
    const a = coerceValue(mine, 'DATE'); const b = coerceValue(theirs, 'DATE');
    if (a != null && b != null) return a !== b;
  }
  return normText(mine) !== normText(theirs);
}

export type CrossCheck = { fieldKey: string; reason: string };

/** Η διαδρομή που στοχεύει μια γραμμή mapping, με τα παλιά `invoiceKey` μεταφρασμένα. */
const pathOfRow = (r: { invoiceKey: string }) => legacyKeyToPath(r.invoiceKey);

/**
 * The field keys `crossCheckOcr` is able to have an opinion about — i.e. whose per-field verdict it
 * OWNS, and which a recomputation may therefore drop before asking it again (`run-flags.ts`).
 */
export function crossCheckKeys(rows: { fieldKey: string; invoiceKey: string }[]): string[] {
  return rows.filter((r) => { const p = pathOfRow(r); return p != null && CROSS_CHECK_PATHS.has(p); }).map((r) => r.fieldKey);
}

/**
 * The base OCR's own reading of the cross-checked paths, taken BEFORE the run projects over it.
 * Without this snapshot the second opinion is lost: the document now holds the TEMPLATE's values, so
 * a later re-check would compare the template against itself and conclude — every single time — that
 * the two readers agree. Stored on the run (`flags.baseOcr`), keyed by canonical path.
 */
export function baseOcrSnapshot(document: DocumentJson): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of CROSS_CHECK_PATHS) out[p] = getPath(document, p);
  return out;
}

/**
 * Το αποθηκευμένο `flags.baseOcr` με κλειδιά διαδρομές. Τα snapshots που γράφτηκαν πριν από το
 * κανονικό JSON κρατούν παλιά flat κλειδιά (`totalAmount`) — μεταφράζονται εδώ, αλλιώς κάθε
 * επανέλεγχος μιας παλιάς εκτέλεσης θα έβρισκε «τίποτα να συγκρίνω».
 */
function snapshotByPath(snapshot: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(snapshot ?? {})) {
    const p = legacyKeyToPath(k);
    if (p != null && !out.has(p)) out.set(p, v);
  }
  return out;
}

/**
 * Every INVOICE mapping row whose target is one of `CROSS_CHECK_PATHS` and whose template value
 * contradicts what the base OCR read. Blank on either side is not a contradiction — a value only
 * one of the two readers found is not evidence that either is wrong.
 */
export function crossCheckOcr(
  rows: { fieldKey: string; invoiceKey: string }[],
  values: Record<string, FieldValue>,
  baseOcr: Record<string, unknown>,
  labelOf: (fieldKey: string) => string,
): CrossCheck[] {
  const snapshot = snapshotByPath(baseOcr);
  const out: CrossCheck[] = [];
  for (const r of rows) {
    const path = pathOfRow(r);
    if (path == null || !CROSS_CHECK_PATHS.has(path)) continue;
    const mine = values[r.fieldKey]?.value ?? null;
    const theirs = (snapshot.get(path) ?? null) as FieldValue['value'];
    if (isBlank(mine) || isBlank(theirs)) continue;
    if (!disagrees(path, mine, theirs)) continue;
    out.push({ fieldKey: r.fieldKey, reason: `Ασυμφωνία «${labelOf(r.fieldKey)}»: πρότυπο ${String(mine)} · OCR ${String(theirs)}` });
  }
  return out;
}

/**
 * The TABLE field key whose read produced NO rows while the base OCR did read lines — i.e. the case
 * where projecting the mapping would replace real invoice lines with an empty list. Null when the
 * table read fine, when the mapping has no line rows, or when there is nothing to fall back to.
 */
export function tableFellThrough(
  rows: { fieldKey: string; invoiceKey: string }[],
  values: Record<string, FieldValue>,
  document: DocumentJson,
): string | null {
  const line = rows.find((r) => pathOfRow(r)?.startsWith('lines.') && r.fieldKey.indexOf('.') > 0);
  if (!line) return null;
  const tableKey = line.fieldKey.slice(0, line.fieldKey.indexOf('.'));
  const read = values[tableKey]?.value;
  if (Array.isArray(read) && read.length > 0) return null;
  return document.lines.length > 0 ? tableKey : null;
}

/**
 * The document's cached summary of its LATEST run (`OcrDocument.reviewFlags`). Deliberately only the
 * two reason lists: the per-field verdict lives on the run itself, where the card that renders it is.
 */
export type ReviewFlags = {
  review: string[]; blocked: string[]; templateSlug: string; templateName: string; runStatus: RunStatus; runId: string;
  /** §14.7 — how the runner found this template; absent when a human named it. */
  recognizedBy?: 'vat' | 'similarity' | 'model';
  /**
   * §14.7 — set by `markUnknownForm` on a document NO template could be matched to. It lives in the
   * same JSON column, which is why it is declared here: a run of any kind rewrites the column whole
   * and the flag therefore clears itself the moment somebody picks a template by hand.
   */
  unknownForm?: boolean;
};
export function buildReviewFlags(
  t: { slug: string; name: string }, status: RunStatus, runId: string,
  flags: Pick<RunFlags, 'review' | 'blocked'>, recognizedBy?: ReviewFlags['recognizedBy'] | null,
): ReviewFlags {
  return {
    review: flags.review, blocked: flags.blocked, templateSlug: t.slug, templateName: t.name,
    runStatus: status, runId, ...(recognizedBy && { recognizedBy }),
  };
}
