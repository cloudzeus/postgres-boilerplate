// Σειριακοί αριθμοί (S/N) στην καταχώριση αγοράς — καθαρό module (χωρίς I/O).
//
// ΓΙΑΤΙ. Ένα είδος που η SoftOne «παρακολουθεί» με σειριακούς (καρτέλα είδους → «SN», `MTRSNUSE` > 0)
// πρέπει να ΜΠΕΙ στην αποθήκη μαζί με τους σειριακούς του: αλλιώς στην πώληση δεν υπάρχει τίποτα
// να διαλέξει ο πωλητής, και η εγγύηση/το ιστορικό της συσκευής δεν βρίσκεται. Ο χώρος τους στη
// SoftOne είναι ο πίνακας `SNLINES` του παραστατικού: μία γραμμή ανά σειριακό, δεμένη με τη γραμμή
// είδους (`MTRLINES` = το `LINENUM` της ITELINES).
//
// ΜΕΤΡΗΜΕΝΟ στη Demo με `calculate` (22/10/2026, χωρίς αποθήκευση):
//   • `SNLINES: [{ MTRLINES, MTRL, CODE }]` κρατιέται ως έχει, δεμένο στη γραμμή (το `SNLINES` το
//     αριθμεί η ίδια)·
//   • η SoftOne ΔΕΝ ελέγχει αν οι σειριακοί είναι όσοι και η ποσότητα (2 τεμάχια + 3 σειριακοί περνά)
//     → τον έλεγχο τον κάνουμε ΕΜΕΙΣ, αλλιώς το απόθεμα και οι σειριακοί του δεν συμφωνούν ποτέ·
//   • η «Μορφή κωδ.SN» του είδους (`SNCODEMSK`, π.χ. `NNNNN`) ΕΛΕΓΧΕΤΑΙ: «Ο κωδικός πρέπει να είναι
//     της μορφής NNNNN» → την ελέγχουμε πριν, με μήνυμα που λέει ΠΟΙΟΣ σειριακός και ΠΟΙΑ γραμμή.
// Είδος χωρίς παρακολούθηση: οι σειριακοί μένουν στο σχόλιο της γραμμής (όπως πάντα), με παρατήρηση.

/** `MTRSNUSE` > 0 ⇒ η SoftOne κρατά σειριακούς για το είδος. `null` = δεν το ξέρουμε (μη συγχρονισμένο). */
export const tracksSerials = (snUse: number | null | undefined): boolean => Number(snUse) > 0;

/**
 * Ταιριάζει ο σειριακός με τη «Μορφή κωδ.SN» της SoftOne; `N` = ψηφίο, `A` = γράμμα, `X`/`*`/`?` =
 * οτιδήποτε, κάθε άλλος χαρακτήρας = ο ίδιος. Ίδιο μήκος. Κενή μορφή = κάθε κωδικός περνά.
 */
export function snMaskMatches(code: string, mask: string | null | undefined): boolean {
  const m = String(mask ?? '').trim();
  if (!m) return true;
  const c = String(code ?? '');
  if (c.length !== m.length) return false;
  for (let i = 0; i < m.length; i++) {
    const k = m[i], ch = c[i];
    if (k === 'N' || k === 'n') { if (!/\d/.test(ch)) return false; }
    else if (k === 'A' || k === 'a') { if (!/\p{L}/u.test(ch)) return false; }
    else if (k === 'X' || k === 'x' || k === '*' || k === '?') continue;
    else if (k.toUpperCase() !== ch.toUpperCase()) return false;
  }
  return true;
}

/** «NNNNN» → «5 ψηφία», για ανθρώπους. */
export function describeSnMask(mask: string | null | undefined): string {
  const m = String(mask ?? '').trim();
  if (!m) return '';
  if (/^N+$/i.test(m)) return `${m.length} ψηφία`;
  if (/^A+$/i.test(m)) return `${m.length} γράμματα`;
  return `μορφή «${m}» (N = ψηφίο, A = γράμμα)`;
}

/** Ποσότητα της γραμμής σε ΒΑΣΙΚΕΣ μονάδες (τεμάχια) — με αυτήν συγκρίνονται οι σειριακοί. */
export function baseQuantity(quantity: number | null | undefined, buyRatio: number | null | undefined, qtyInBase: boolean): number | null {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return null;
  const r = Number(buyRatio) > 0 ? Number(buyRatio) : 1;
  return qtyInBase ? q : Math.round(q * r * 1_000_000) / 1_000_000;
}

export type SerialLineVerdict = {
  rowIndex: number;
  /** Θα γραφτούν στο `SNLINES` (είδος με παρακολούθηση, γραμμή ITELINES). */
  toSnLines: boolean;
  serials: string[];
  /** Τεμάχια σε βασική μονάδα (για τη σύγκριση). */
  pieces: number | null;
  countMismatch: boolean;
  badFormat: string[];
  /** Είδος με παρακολούθηση χωρίς κανέναν σειριακό στο χαρτί. */
  missing: boolean;
  /** Σειριακοί σε είδος ΧΩΡΙΣ παρακολούθηση — μένουν μόνο στο σχόλιο. */
  untracked: boolean;
  /** Η παρακολούθηση του είδους δεν είναι γνωστή (καθρέφτης χωρίς το πεδίο, η SoftOne δεν απάντησε). */
  unknown: boolean;
  mask: string | null;
};

export type SerialLineInput = {
  rowIndex: number;
  serials: readonly string[] | null | undefined;
  quantity: number | null | undefined;
  buyRatio?: number | null;
  qtyInBase?: boolean;
  /** Η γραμμή θα φύγει ως είδος αποθήκης (ITELINES). Μόνο εκεί υπάρχουν σειριακοί. */
  isStockLine: boolean;
  snUse: number | null | undefined;
  snMask?: string | null;
};

export function serialVerdict(l: SerialLineInput): SerialLineVerdict {
  const serials = [...new Set((l.serials ?? []).map((s) => String(s).trim()).filter(Boolean))];
  const tracked = l.isStockLine && tracksSerials(l.snUse);
  const unknown = l.isStockLine && (l.snUse == null);
  const pieces = baseQuantity(l.quantity, l.buyRatio, l.qtyInBase === true);
  const toSnLines = tracked && serials.length > 0;
  return {
    rowIndex: l.rowIndex,
    toSnLines,
    serials,
    pieces,
    countMismatch: toSnLines && pieces != null && Math.abs(pieces - serials.length) > 1e-6,
    badFormat: toSnLines ? serials.filter((s) => !snMaskMatches(s, l.snMask)) : [],
    missing: tracked && serials.length === 0,
    untracked: l.isStockLine && !tracked && !unknown && serials.length > 0,
    unknown: unknown && serials.length > 0,
    mask: l.snMask?.trim() || null,
  };
}

/**
 * Μοιράζει τους σειριακούς μιας γραμμής που σπάει σε ΠΟΛΛΕΣ γραμμές ITELINES (μετασχηματισμός από
 * δελτίο: μία ανά γραμμή-πηγή), κατά σειρά, όσοι και τα τεμάχια κάθε κομματιού. Ό,τι περισσέψει πάει
 * στο τελευταίο — δεν χάνεται κανένας.
 */
export function splitSerials(serials: readonly string[], pieces: readonly number[]): string[][] {
  const out: string[][] = pieces.map(() => []);
  if (!pieces.length) return out;
  let k = 0;
  pieces.forEach((p, i) => {
    const take = Math.max(0, Math.round(p));
    out[i] = serials.slice(k, k + take);
    k += take;
  });
  if (k < serials.length) out[out.length - 1].push(...serials.slice(k));
  return out;
}

/** Κείμενα για τα μηνύματα (ένα ανά γραμμή), με αριθμό γραμμής όπως τον βλέπει ο χρήστης (από 1). */
export function serialIssueText(v: SerialLineVerdict, itemLabel?: string | null): string[] {
  const at = `Γραμμή ${v.rowIndex + 1}${itemLabel ? ` (${itemLabel})` : ''}`;
  const out: string[] = [];
  if (v.countMismatch) out.push(`${at}: ${v.serials.length} σειριακοί για ${String(v.pieces).replace('.', ',')} τεμάχια — πρέπει να είναι όσοι και τα τεμάχια.`);
  if (v.badFormat.length) out.push(`${at}: ${v.badFormat.map((s) => `«${s}»`).join(', ')} δεν έχει τη μορφή που ζητά η SoftOne για το είδος (${describeSnMask(v.mask)}).`);
  if (v.missing) out.push(`${at}: το είδος παρακολουθεί σειριακούς στη SoftOne, αλλά στο παραστατικό δεν διαβάστηκε κανένας.`);
  if (v.untracked) out.push(`${at}: οι σειριακοί γράφονται μόνο στο σχόλιο της γραμμής — το είδος δεν παρακολουθεί σειριακούς στη SoftOne.`);
  if (v.unknown) out.push(`${at}: δεν ξέρουμε αν το είδος παρακολουθεί σειριακούς (η SoftOne δεν απάντησε) — γράφονται στο σχόλιο της γραμμής.`);
  return out;
}
