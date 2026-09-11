// lib/templates/fingerprint.ts — PURE. «Which template is this document?» by layout (spec §14.7).
//
// The ΑΦΜ answers that question whenever the issuer is known. When it is not — a new supplier, an
// ΑΦΜ the OCR misread, a form with no ΑΦΜ at all — the only thing left is what the page LOOKS like:
// the issuer's printed name, the vocabulary that is peculiar to this form (its column headings, its
// product words) and the page ratio. None of it costs an extra model call: it is built from the
// `rawText` the base OCR already produced.
//
// Deliberately NOT a hash: two invoices of the same issuer differ in every value. The fingerprint
// keeps only what does NOT change between two documents of the same layout, and the comparison is a
// similarity, never an equality.
import { normalizeGreek } from '@/lib/ocr/doc-type-classify';
import { dice } from '@/lib/ocr/line-match';
import { normalizeVat } from './schema';

export type Fingerprint = {
  afm: string | null;
  issuer: string | null;
  /** The most frequent identifying words of the layout, normalised and capped. */
  words: string[];
  /** height / width of page 1 — a receipt roll and an A4 invoice are never the same form. */
  aspect: number | null;
};

/** A best score below this is «I do not know this form» — the document gets the unknown-form flag. */
export const MATCH_THRESHOLD = 0.55;
/** Two templates within this of each other is a tie the layout alone cannot break. */
export const AMBIGUITY_GAP = 0.1;
/** How many words a fingerprint keeps. */
export const FINGERPRINT_WORDS = 40;
/** Shorter than this and a word says nothing about the layout. */
const MIN_WORD = 4;
/** Aspect difference at which the page-ratio part of the score is fully spent. */
const ASPECT_SPAN = 0.3;

/**
 * Words every Greek business document prints, which therefore distinguish none of them. Normalised
 * (accent-free uppercase) because that is the alphabet `normalizeGreek` leaves behind.
 */
const STOPWORDS = new Set([
  'ΤΙΜΟΛΟΓΙΟ', 'ΤΙΜΟΛΟΓΙΟΥ', 'ΠΟΣΟΤΗΤΑ', 'ΠΟΣΟΤΗΤΑΣ', 'ΣΥΝΟΛΟ', 'ΣΥΝΟΛΑ', 'ΣΥΝΟΛΙΚΗ', 'ΣΥΝΟΛΙΚΟ',
  'ΦΠΑ', 'ΑΦΜ', 'ΔΟΥ', 'ΗΜΕΡΟΜΗΝΙΑ', 'ΑΞΙΑ', 'ΑΞΙΑΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΠΟΣΟ', 'ΚΑΘΑΡΗ', 'ΚΑΘΑΡΟ',
  'ΠΕΛΑΤΗΣ', 'ΠΕΛΑΤΗ', 'ΚΩΔΙΚΟΣ', 'ΚΩΔ', 'ΤΕΜΑΧΙΑ', 'ΣΕΛΙΔΑ', 'ΑΡΙΘΜΟΣ', 'ΑΡΙΘ', 'ΕΙΔΟΣ', 'ΜΟΝΑΔΑ',
  'ΤΙΜΗ', 'ΕΚΠΤΩΣΗ', 'ΠΛΗΡΩΜΗ', 'ΠΛΗΡΩΜΗΣ', 'ΕΠΩΝΥΜΙΑ', 'ΔΙΕΥΘΥΝΣΗ', 'ΤΗΛΕΦΩΝΟ', 'ΣΕΙΡΑ',
  'INVOICE', 'TOTAL', 'QUANTITY', 'DESCRIPTION', 'AMOUNT', 'DATE', 'PAGE', 'PRICE', 'CUSTOMER',
]);

const sane = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 10 ? n : null;

/** Extract the identifying vocabulary of a page of text. */
function wordsOf(text: string): string[] {
  const counts = new Map<string, number>();
  for (const tok of normalizeGreek(text).split(' ')) {
    if (tok.length < MIN_WORD) continue;
    if (/^\d+$/.test(tok)) continue;              // an invoice number / a date / an amount is not a layout
    if (STOPWORDS.has(tok)) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  // Frequency first, then alphabetical — so the same page always produces the same fingerprint and
  // two runs of the recogniser can never disagree over a tie.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, FINGERPRINT_WORDS)
    .map(([w]) => w);
}

export function buildFingerprint(input: {
  issuerName?: string | null;
  afm?: unknown;
  text?: string | null;
  aspect?: number | null;
}): Fingerprint {
  const issuer = normalizeGreek(input.issuerName ?? '') || null;
  return {
    afm: normalizeVat(input.afm),
    issuer,
    words: input.text ? wordsOf(input.text) : [],
    aspect: sane(input.aspect),
  };
}

/** Nothing to compare on: such a fingerprint can neither match nor be matched. */
export function isEmptyFingerprint(fp: Fingerprint | null): boolean {
  return !fp || (!fp.issuer && fp.words.length === 0 && fp.aspect == null);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 0–1 over three parts — the issuer's name (0.4), the vocabulary (0.5), the page ratio (0.1). A part
 * EITHER side is missing is dropped and its weight is shared out over the rest, so a template whose
 * sample had no text layer is still comparable on the issuer alone instead of being scored down for
 * a fact nobody knows.
 */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  const parts: [number, number][] = [];        // [weight, score]
  if (a.issuer && b.issuer) parts.push([0.4, dice(a.issuer, b.issuer)]);
  if (a.words.length && b.words.length) parts.push([0.5, jaccard(a.words, b.words)]);
  if (a.aspect != null && b.aspect != null) {
    parts.push([0.1, 1 - Math.min(1, Math.abs(a.aspect - b.aspect) / ASPECT_SPAN)]);
  }
  const weight = parts.reduce((s, [w]) => s + w, 0);
  if (weight === 0) return 0;
  return parts.reduce((s, [w, v]) => s + w * v, 0) / weight;
}

export type TemplateCandidate = { templateId: string; fingerprints: (Fingerprint | null)[] };

/**
 * Best score per template — a template is whatever ANY of its samples looks like, so the strongest
 * fingerprint wins. Candidates with nothing to compare on are left out entirely rather than ranked
 * last with a 0: «no evidence» is not the same claim as «evidence against».
 */
export function rankTemplates(fp: Fingerprint, candidates: TemplateCandidate[]): { templateId: string; score: number }[] {
  if (isEmptyFingerprint(fp)) return [];
  const out: { templateId: string; score: number }[] = [];
  for (const c of candidates) {
    const usable = c.fingerprints.filter((f): f is Fingerprint => !isEmptyFingerprint(f));
    if (!usable.length) continue;
    out.push({ templateId: c.templateId, score: Math.max(...usable.map((f) => similarity(fp, f))) });
  }
  return out.sort((x, y) => y.score - x.score || (x.templateId < y.templateId ? -1 : x.templateId > y.templateId ? 1 : 0));
}

/** Read a fingerprint back out of a JSON column; `null` for anything that is not one. */
export function toFingerprint(raw: unknown): Fingerprint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    afm: typeof o.afm === 'string' ? o.afm : null,
    issuer: typeof o.issuer === 'string' ? o.issuer : null,
    words: Array.isArray(o.words) ? o.words.filter((w): w is string => typeof w === 'string') : [],
    aspect: sane(o.aspect),
  };
}
