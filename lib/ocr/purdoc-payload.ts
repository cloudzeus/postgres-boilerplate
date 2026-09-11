// lib/ocr/purdoc-payload.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
// Ο μεταφραστής «κανονικό έγγραφο (§17.1) → SoftOne PURDOC setData payload» και οι προϋποθέσεις
// που πρέπει να ισχύουν για να επιτραπεί η καταχώριση. Ζει χωριστά από το `post-softone.ts` ώστε
// να δοκιμάζεται και να εμφανίζεται (dry-run) χωρίς να μπορεί καν να αγγίξει το SoftOne.
import type { DocumentJson } from './canonical';

/** Η πρώτη νέα γραμμή. Το SoftOne θέλει LINENUM που δεν υπάρχει ήδη στο παραστατικό. */
export const FIRST_LINENUM = 9000001;

/** Ό,τι ξέρει η εφαρμογή για μια γραμμή, πέρα από το ίδιο το έγγραφο (από `OcrInvoiceItem`). */
export type PurdocLineCtx = {
  rowIndex: number;
  mtrl?: number | null;
  expn?: number | null;
  isService?: boolean | null;
};

export type PurdocContext = {
  /** SoftOne SERIES (αριθμός σειράς αγορών). */
  series: number;
  /** SoftOne TRDR του προμηθευτή. */
  trdr: number;
  /** Προαιρετικό COMPANY — κανονικά το session είναι ήδη δεμένο σε εταιρία. */
  company?: number | null;
  lines: PurdocLineCtx[];
  /** Συντελεστής ΦΠΑ (π.χ. 24) → κωδικός ΦΠΑ SoftOne (`VatCategory.code`). */
  vatIdByRate: Record<number, number>;
  comments?: string | null;
};

export type PurdocHeader = {
  SERIES: number;
  TRNDATE: string;
  TRDR: number;
  FINCODE?: string;
  COMPANY?: number;
  COMMENTS?: string;
  MYDATAMARK?: string;
  MYDATAUID?: string;
};
export type PurdocItemLine = { LINENUM: number; MTRL: number; QTY1: number; PRICE: number; DISC1PRC: number; VAT?: number; COMMENTS?: string };
export type PurdocExpenseLine = { LINENUM: number; EXPN: number; VAT?: number; EXPVAL: number };

export type PurdocPayload = {
  OBJECT: 'PURDOC';
  KEY: '';
  DATA: {
    PURDOC: PurdocHeader[];
    ITELINES?: PurdocItemLine[];
    SRVLINES?: PurdocItemLine[];
    EXPANAL?: PurdocExpenseLine[];
  };
};

/** Τα πεδία του `OcrDocument` που κρίνουν αν επιτρέπεται η καταχώριση. */
export type PostingDoc = {
  status: string;
  category: string | null;
  softoneTrdr: number | null;
  softoneSeries: string | null;
  seriesSource: number | null;
};

export type BlockerCode =
  | 'not_completed'
  | 'no_category'
  | 'no_trader'
  | 'no_series'
  | 'no_date'
  | 'no_number'
  | 'no_lines'
  | 'unmatched_lines'
  | 'no_vat_category'
  | 'totals_mismatch';

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const text = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? undefined : s;
};

/** Ημερομηνία εγγράφου → `YYYY-MM-DD` (το έγγραφο είναι ήδη κανονικοποιημένο· κόβουμε ώρα αν υπάρχει). */
const trnDate = (date: string | null): string => (date ?? '').slice(0, 10);

const vatIdFor = (rate: number | null, map: Record<number, number>): number | undefined => {
  if (rate == null || !Number.isFinite(rate)) return undefined;
  const id = map[rate];
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
};

/**
 * Χτίζει το payload του `setData` για object PURDOC. ΔΕΝ κρίνει αν επιτρέπεται η καταχώριση —
 * αυτό είναι δουλειά του `postingBlockers`, ώστε το dry-run να δείχνει payload ΚΑΙ εμπόδια μαζί.
 * Κενοί πίνακες παραλείπονται (το SoftOne διαβάζει ένα άδειο array ως «σβήσε τις γραμμές»).
 */
export function buildPurdocPayload(document: DocumentJson, ctx: PurdocContext): PurdocPayload {
  const byRow = new Map<number, PurdocLineCtx>(ctx.lines.map((l) => [l.rowIndex, l]));

  const header: PurdocHeader = {
    SERIES: ctx.series,
    TRNDATE: trnDate(document.date),
    TRDR: ctx.trdr,
  };
  if (ctx.company != null) header.COMPANY = ctx.company;
  const fincode = text(document.type.number);
  if (fincode) header.FINCODE = fincode;
  const comments = text(ctx.comments);
  if (comments) header.COMMENTS = comments;
  const mark = text(document.digital.mark);
  if (mark) header.MYDATAMARK = mark;
  const uid = text(document.digital.uid);
  if (uid) header.MYDATAUID = uid;

  const items: PurdocItemLine[] = [];
  const services: PurdocItemLine[] = [];
  const expenses: PurdocExpenseLine[] = [];

  document.lines.forEach((line, i) => {
    const match = byRow.get(i);
    if (!match) return;
    const vat = vatIdFor(line.vatRate, ctx.vatIdByRate);
    if (match.mtrl != null) {
      const target = match.isService ? services : items;
      const row: PurdocItemLine = {
        LINENUM: FIRST_LINENUM + target.length,
        MTRL: match.mtrl,
        QTY1: num(line.quantity, 1),
        PRICE: num(line.unitPrice, 0),
        DISC1PRC: num(line.discount, 0),
      };
      if (vat != null) row.VAT = vat;
      const name = text(line.name);
      if (name) row.COMMENTS = name;
      target.push(row);
      return;
    }
    if (match.expn != null) {
      expenses.push({
        LINENUM: FIRST_LINENUM + expenses.length,
        EXPN: match.expn,
        ...(vat != null ? { VAT: vat } : {}),
        EXPVAL: num(line.net, 0),
      });
    }
  });

  const DATA: PurdocPayload['DATA'] = { PURDOC: [header] };
  if (items.length) DATA.ITELINES = items;
  if (services.length) DATA.SRVLINES = services;
  if (expenses.length) DATA.EXPANAL = expenses;
  return { OBJECT: 'PURDOC', KEY: '', DATA };
}

/** Ανοχή αθροίσματος γραμμών έναντι της τυπωμένης καθαρής αξίας. */
const NET_TOLERANCE = 0.05;

/**
 * Κάθε λόγος για τον οποίο η καταχώριση δεν πρέπει να γίνει, με σταθερή σειρά (το UI τα δείχνει
 * ως λίστα). Επιστρέφει κωδικούς· τα ελληνικά κείμενα ζουν στο `POST_ERROR_TEXT`.
 */
export function postingBlockers(document: DocumentJson, doc: PostingDoc, ctx: Pick<PurdocContext, 'lines' | 'vatIdByRate'>): BlockerCode[] {
  const out: BlockerCode[] = [];
  if (doc.status !== 'COMPLETED') out.push('not_completed');
  if (!doc.category) out.push('no_category');
  if (!doc.softoneTrdr) out.push('no_trader');
  if (!doc.softoneSeries || !doc.seriesSource) out.push('no_series');
  if (!trnDate(document.date)) out.push('no_date');
  if (!text(document.type.number)) out.push('no_number');

  const byRow = new Map<number, PurdocLineCtx>(ctx.lines.map((l) => [l.rowIndex, l]));
  if (document.lines.length === 0) {
    out.push('no_lines');
  } else {
    const unmatched = document.lines.some((_, i) => {
      const m = byRow.get(i);
      return !m || (m.mtrl == null && m.expn == null);
    });
    if (unmatched) out.push('unmatched_lines');
    const missingVat = document.lines.some((line) => vatIdFor(line.vatRate, ctx.vatIdByRate) == null);
    if (missingVat) out.push('no_vat_category');
  }

  if (document.totals.net != null && document.lines.length > 0) {
    const sum = document.lines.reduce((acc, l) => acc + (l.net ?? 0), 0);
    if (Math.abs(sum - document.totals.net) > NET_TOLERANCE) out.push('totals_mismatch');
  }
  return out;
}
