// Παρακράτηση φόρου σε παραστατικό αγοράς — καθαρό module (χωρίς I/O).
//
// Η παρακράτηση ΜΕΙΩΝΕΙ το πληρωτέο (π.χ. ΤΠΥ μηχανολόγου: καθαρή 3.530, ΦΠΑ 847,20, σύνολο
// 4.377,20, παρακράτηση 3% = 105,90, πληρωτέο 4.271,30). Στη Demo η SoftOne ΔΕΝ την υπολογίζει μόνη
// της — ούτε η σειρά «ΔΠΡΚ · Δαπάνες με παρακράτηση φόρου» (μετρημένο με `calculate`, 22/10/2026:
// ίδιο σύνολο με την απλή σειρά). Άρα εδώ: (1) την ελέγχουμε (ποσό, ποσοστό, πληρωτέο), (2) λέμε
// πότε ΛΕΙΠΕΙ ενώ θα έπρεπε, και (3) ζητάμε ρητή απόφαση πριν από την καταχώριση — ποτέ σιωπηλά.

import type { DocumentJson } from '@/lib/ocr/canonical';

/**
 * Γνωστά ποσοστά παρακράτησης φόρου εισοδήματος (Ν.4172/2013): 20% αμοιβές ελεύθερων επαγγελματιών,
 * 15% τόκοι, 10% (π.χ. αμοιβές εργολάβων σε κάποιες περιπτώσεις), 8% / 4% / 1% προμήθειες προς
 * Δημόσιο / ΝΠΔΔ (υπηρεσίες / αγαθά), 3% μελέτες & τεχνικά έργα (μηχανικοί), 0 όταν δεν υπάρχει.
 */
export const KNOWN_WITHHOLDING_RATES = [20, 15, 10, 8, 4, 3, 1];

export interface WithholdingAnalysis {
  /** Ποσό παρακράτησης που τυπώθηκε (ή συνάγεται από σύνολο − πληρωτέο). */
  amount: number | null;
  /** Ποσοστό επί της καθαρής αξίας. */
  rate: number | null;
  /** Το πλησιέστερο γνωστό ποσοστό, όταν ταιριάζει (±0,05). */
  knownRate: number | null;
  issues: string[];
  /** Παροχή υπηρεσιών > 300 € χωρίς παρακράτηση — μάλλον έπρεπε (20%). */
  maybeMissing: boolean;
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const eur = (v: number) => `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function analyzeWithholding(doc: DocumentJson, opts: { isServiceInvoice?: boolean } = {}): WithholdingAnalysis {
  const t = doc.totals ?? ({} as DocumentJson['totals']);
  const net = t.net ?? null, total = t.total ?? null, payable = t.payable ?? null;
  let amount = t.withholding != null && Math.abs(t.withholding) > 0.004 ? Math.abs(t.withholding) : null;
  const issues: string[] = [];
  // Δεν τυπώθηκε ως ποσό, αλλά το πληρωτέο είναι μικρότερο από το σύνολο χωρίς άλλη εξήγηση.
  if (amount == null && total != null && payable != null && total - payable > 0.5 && !(t.fees && t.fees > 0)) {
    amount = r2(total - payable);
  }
  const rate = amount != null && net != null && net > 0 ? r2((amount / net) * 100) : null;
  const knownRate = rate == null ? null : KNOWN_WITHHOLDING_RATES.find((k) => Math.abs(k - rate) <= 0.05) ?? null;

  if (amount != null) {
    if (rate != null && knownRate == null) issues.push(`Η παρακράτηση ${eur(amount)} είναι ${String(rate).replace('.', ',')}% της καθαρής αξίας — όχι γνωστό ποσοστό (20%, 15%, 10%, 8%, 4%, 3%, 1%). Έλεγξε τα ποσά.`);
    if (total != null && payable != null && Math.abs(r2(total - amount) - payable) > 0.02) {
      issues.push(`Πληρωτέο ${eur(payable)} ≠ σύνολο ${eur(total)} − παρακράτηση ${eur(amount)} (= ${eur(r2(total - amount))}).`);
    }
  }
  const maybeMissing = amount == null && opts.isServiceInvoice === true && net != null && net > 300;
  return { amount, rate, knownRate, issues, maybeMissing };
}

/** Είναι τιμολόγιο παροχής υπηρεσιών (εκεί ισχύει η παρακράτηση 20% των ελεύθερων επαγγελματιών); */
export function isServiceInvoice(doc: DocumentJson, seriesName?: string | null): boolean {
  const s = `${seriesName ?? ''} ${doc.type?.label ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /παροχης υπηρεσιων|\bτπυ\b|αποδειξη παροχης/.test(s) || doc.type?.myDataType === '2.1';
}

/** Η σημείωση που μπαίνει στο σχόλιο της SoftOne όταν η παρακράτηση θα περαστεί από τον λογιστή. */
export function withholdingNote(a: WithholdingAnalysis): string | null {
  if (a.amount == null) return null;
  return `Παρακράτηση φόρου ${eur(a.amount)}${a.rate != null ? ` (${String(a.knownRate ?? a.rate).replace('.', ',')}%)` : ''} — να καταχωριστεί στη SoftOne`;
}
