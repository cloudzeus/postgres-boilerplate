// ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ → ΤΙΜΟΛΟΓΙΟ: η σύγκριση και η σύνδεση γραμμών (καθαρό module, χωρίς I/O).
//
// Πώς μετασχηματίζει η SoftOne (μετρημένο στο Demo, ζεύγος ΔΑ 2720 → ΤΙΜ 2724): το τιμολόγιο είναι
// ΝΕΟ παραστατικό αγορών (σειρά «Τιμολόγιο Αγοράς», 2061) και ΚΑΘΕ γραμμή του δείχνει τη γραμμή του
// δελτίου από την οποία προέρχεται — `ITELINES.FINDOCS` (παραστατικό) + `ITELINES.MTRLINESS`
// (γραμμή). Η SoftOne κλείνει μόνη της την εκκρεμότητα του δελτίου («Ατιμολόγητα ΔΑ»): ανεβάζει
// το `QTY1COV` της γραμμής-πηγής και γράφει `FULLYTRANSF` (1 πλήρως / 2 μερικώς) στο δελτίο.
// Το `calculate` των Web Services κρατά τη σύνδεση (επαληθευμένο), άρα η ίδια δομή γράφεται με setData.
//
// ΕΔΩ ΚΡΙΝΕΤΑΙ ΑΝ ΕΠΙΤΡΕΠΕΤΑΙ: κάθε γραμμή ΕΙΔΟΥΣ του τιμολογίου πρέπει να καλύπτεται ΟΛΟΚΛΗΡΗ από
// ανοιχτές γραμμές δελτίων με το ίδιο είδος. Ποσότητες σε ΒΑΣΙΚΕΣ μονάδες (QTY1), ώστε «2 κιβώτια
// των 100» να συγκρίνεται σωστά με «200 τεμάχια». Περίσσεια ή είδος εκτός δελτίου ⇒ ΜΠΛΟΚ: μια
// γραμμή χωρίς πηγή σε τιμολόγιο από δελτίο είναι ακριβώς το λάθος που θέλουμε να αποκλείσουμε.

export const QTY_EPS = 1e-6;

/** Ανοιχτή γραμμή δελτίου (MTRLINES), με ό,τι ΜΕΝΕΙ να τιμολογηθεί. */
export interface NoteLine {
  findoc: number;
  /** `MTRLINES` — ο δείκτης της γραμμής μέσα στο δελτίο (αυτό που πάει στο `MTRLINESS`). */
  mtrlines: number;
  mtrl: number;
  /** Ποσότητα σε βασική μονάδα (QTY1). */
  qty1: number;
  /** Ό,τι έχει ήδη τιμολογηθεί (QTY1COV) ή ακυρωθεί (QTY1CANC). */
  covered1: number;
  /** Ταξινόμηση FIFO: παλαιότερο δελτίο πρώτο. */
  noteDate: string | null;
  noteCode: string | null;
}

export interface InvoiceLine {
  rowIndex: number;
  /** Είδος αποθήκης (όχι υπηρεσία) — μόνο αυτά υπάρχουν στο δελτίο. `null` = δεν αντιστοιχίστηκε. */
  mtrl: number | null;
  isService: boolean;
  /** Ποσότητα σε βασική μονάδα (ποσότητα αγορών × MU31). */
  qty1: number;
  name: string | null;
  /** Έκπτωση σε ΠΟΣΟ: δεν μοιράζεται σε δύο γραμμές-πηγές χωρίς να αλλάξει η αξία ⇒ δεν διασπάται. */
  hasDiscountAmount?: boolean;
}

export interface SourceLink { findoc: number; mtrlines: number; qty1: number }

export type LineVerdict =
  | { rowIndex: number; status: 'covered'; links: SourceLink[] }
  | { rowIndex: number; status: 'not_stock' }
  | { rowIndex: number; status: 'unmatched' }
  | { rowIndex: number; status: 'not_in_note'; mtrl: number }
  | { rowIndex: number; status: 'excess'; mtrl: number; missing1: number; links: SourceLink[] }
  | { rowIndex: number; status: 'split_discount'; links: SourceLink[] };

export interface NoteRest { findoc: number; mtrlines: number; mtrl: number; open1: number; left1: number }

export interface ConversionPlan {
  /** `match`: όλα ταιριάζουν και τα δελτία κλείνουν· `partial`: το τιμολόγιο καλύπτεται, τα δελτία αφήνουν υπόλοιπο· `blocked`: δεν επιτρέπεται. */
  status: 'match' | 'partial' | 'blocked';
  lines: LineVerdict[];
  /** Ανά γραμμή δελτίου: ανοιχτή ποσότητα και τι θα μείνει μετά τον μετασχηματισμό. */
  rest: NoteRest[];
  /** Σύνδεση ανά γραμμή τιμολογίου (μόνο για `covered`). */
  links: Map<number, SourceLink[]>;
}

const open1 = (n: NoteLine) => Math.max(0, n.qty1 - n.covered1);

/**
 * Κατανομή FIFO: κάθε γραμμή είδους του τιμολογίου «τρώει» από τις ανοιχτές γραμμές δελτίων με το
 * ίδιο είδος, παλαιότερο δελτίο πρώτο και με τη σειρά των γραμμών. Μία γραμμή τιμολογίου μπορεί να
 * καλυφθεί από πολλές γραμμές δελτίων (π.χ. 10 = 4 + 6) — τότε γίνεται πολλές γραμμές με την ίδια τιμή.
 */
export function planConversion(invoice: InvoiceLine[], notes: NoteLine[]): ConversionPlan {
  const pool = [...notes]
    .sort((a, b) => String(a.noteDate ?? '').localeCompare(String(b.noteDate ?? '')) || a.findoc - b.findoc || a.mtrlines - b.mtrlines)
    .map((n) => ({ n, left: open1(n) }));
  const lines: LineVerdict[] = [];
  const links = new Map<number, SourceLink[]>();
  for (const l of invoice) {
    if (l.isService) { lines.push({ rowIndex: l.rowIndex, status: 'not_stock' }); continue; }
    if (l.mtrl == null) { lines.push({ rowIndex: l.rowIndex, status: 'unmatched' }); continue; }
    const same = pool.filter((p) => p.n.mtrl === l.mtrl && p.left > QTY_EPS);
    if (!same.length) { lines.push({ rowIndex: l.rowIndex, status: 'not_in_note', mtrl: l.mtrl }); continue; }
    let need = l.qty1;
    const got: SourceLink[] = [];
    for (const p of same) {
      if (need <= QTY_EPS) break;
      const take = Math.min(need, p.left);
      got.push({ findoc: p.n.findoc, mtrlines: p.n.mtrlines, qty1: round6(take) });
      p.left = round6(p.left - take);
      need = round6(need - take);
    }
    if (need > QTY_EPS) { lines.push({ rowIndex: l.rowIndex, status: 'excess', mtrl: l.mtrl, missing1: need, links: got }); continue; }
    if (got.length > 1 && l.hasDiscountAmount) { lines.push({ rowIndex: l.rowIndex, status: 'split_discount', links: got }); continue; }
    lines.push({ rowIndex: l.rowIndex, status: 'covered', links: got });
    links.set(l.rowIndex, got);
  }
  const rest: NoteRest[] = pool.map((p) => ({ findoc: p.n.findoc, mtrlines: p.n.mtrlines, mtrl: p.n.mtrl, open1: open1(p.n), left1: p.left }));
  const blocked = lines.some((v) => v.status === 'unmatched' || v.status === 'not_in_note' || v.status === 'excess' || v.status === 'split_discount')
    || links.size === 0;
  // Μόνο δελτία που ΧΡΗΣΙΜΟΠΟΙΗΘΗΚΑΝ κρίνουν το «μερικό»: ένα επιλεγμένο δελτίο που δεν άγγιξε καμία γραμμή είναι λάθος επιλογή.
  const used = new Set([...links.values()].flat().map((s) => s.findoc));
  const untouchedNote = [...new Set(notes.map((n) => n.findoc))].some((f) => !used.has(f));
  const leftover = rest.some((r) => r.left1 > QTY_EPS);
  const status: ConversionPlan['status'] = blocked || untouchedNote ? 'blocked' : leftover ? 'partial' : 'match';
  return { status, lines, rest, links };
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Μόνο τα ψηφία ενός αριθμού παραστατικού («ΔΑ-000123» → «123»), για να βρεθεί το δελτίο που αναφέρει το τιμολόγιο. */
export function docNumberDigits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D+/g, '').replace(/^0+/, '');
}

/**
 * Πόσο πιθανό είναι ΑΥΤΟ το δελτίο να είναι εκείνο του τιμολογίου: 2 = ο αριθμός του δελτίου που
 * τυπώνει το τιμολόγιο ταιριάζει, 1 = ίδιο είδος σε κοινές γραμμές, 0 = τίποτα κοινό.
 */
export function noteScore(note: { fincode: string | null; mtrls: number[] }, invoiceRefs: string[], invoiceMtrls: number[]): number {
  const n = docNumberDigits(note.fincode);
  // Ίσοι αριθμοί, ή ο ένας κατάληξη του άλλου με τουλάχιστον 3 ψηφία (πρόθεμα σειράς/έτους στο ένα από τα δύο).
  if (n && invoiceRefs.some((r) => { const d = docNumberDigits(r); return d && (d === n || (Math.min(d.length, n.length) >= 3 && (d.endsWith(n) || n.endsWith(d)))); })) return 2;
  return note.mtrls.some((m) => invoiceMtrls.includes(m)) ? 1 : 0;
}

/** «2041=2061, 2043=3261» → Map σειρά-δελτίου → σειρά-τιμολογίου. Άκυρα κομμάτια αγνοούνται. */
export function parseConversionMap(text: unknown): Map<number, number> {
  const out = new Map<number, number>();
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const m = part.match(/^\s*(\d+)\s*(?:=|→|->|:)\s*(\d+)\s*$/);
    if (m) out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

export const DEFAULT_CONVERSION_MAP = '2041=2061, 2043=3261';

export const VERDICT_TEXT: Record<LineVerdict['status'], string> = {
  covered: 'Καλύπτεται από το δελτίο',
  not_stock: 'Υπηρεσία / έξοδο — δεν περνά από δελτίο',
  unmatched: 'Η γραμμή δεν έχει αντιστοιχιστεί σε είδος',
  not_in_note: 'Το είδος δεν υπάρχει (ανοιχτό) στο δελτίο',
  excess: 'Το τιμολόγιο έχει μεγαλύτερη ποσότητα από ό,τι μένει στο δελτίο',
  split_discount: 'Έκπτωση σε ποσό σε γραμμή που μοιράζεται σε πολλές γραμμές δελτίου',
};
