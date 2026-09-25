// lib/ocr/line-allocation.ts
// Ο ΕΠΙΜΕΡΙΣΜΟΣ μιας γραμμής παραστατικού σε πολλούς λογαριασμούς γενικής.
//
// Ο χρήστης δηλώνει ΠΟΣΟΣΤΑ· στο SoftOne φεύγουν ΠΟΣΑ. Ανάμεσά τους υπάρχει στρογγυλοποίηση, και
// εκεί κρύβεται το λάθος που θα φανεί στο λογιστήριο: 1.055,00 σε τρία ίσα μέρη κάνει 351,666…
// και τρία × 351,67 = 1.055,01. Ένα λεπτό παραπάνω σε κάθε παραστατικό είναι ασυμφωνία.
//
// Ο κανόνας εδώ: όλοι οι επιμερισμοί εκτός του τελευταίου στρογγυλοποιούνται κανονικά, και ο
// ΤΕΛΕΥΤΑΙΟΣ παίρνει ό,τι περισσεύει ώστε το άθροισμα να είναι ΑΚΡΙΒΩΣ το σύνολο της γραμμής.

/**
 * ΠΟΙΟ μητρώο δέχεται το κομμάτι — η εφαρμογή δίνεται σε πελάτες **και των δύο** κατηγοριών βιβλίων:
 *  • `LINEITEM`  — χρεοπίστωση (`MTRL` SODTYPE 53), διπλογραφικά· ο κωδικός της ΕΙΝΑΙ ο λογαριασμός ΕΓΛΣ.
 *  • `SXACCOUNT` — λογαριασμός εσόδων/εξόδων (`MTRL` SODTYPE 61), απλογραφικά (βιβλία Β').
 * Και τα δύο είναι `MTRL`, άρα ο σκέτος αριθμός δεν αρκεί για να πει κανείς πού δείχνει.
 */
export type AllocationKind = 'LINEITEM' | 'SXACCOUNT';

export const ALLOCATION_KINDS: readonly AllocationKind[] = ['LINEITEM', 'SXACCOUNT'];

/** Ένας επιμερισμός όπως τον δηλώνει η φόρμα. */
export interface AllocationInput {
  /** Η εγγραφή μητρώου που δέχεται το κομμάτι — ποιο μητρώο το λέει το {@link AllocationInput.kind}. */
  registryMtrl: number;
  kind?: AllocationKind;
  /** Ο λογαριασμός τη στιγμή της επιλογής, για το ιστορικό. */
  accountCode?: string | null;
  /** Ποσοστό 0–100. */
  percent: number;
}

/** Ένας επιμερισμός έτοιμος για αποθήκευση/αποστολή. */
export interface AllocationLine extends AllocationInput {
  order: number;
  /** Το ποσό που θα σταλεί, σε 2 δεκαδικά. */
  amount: number;
}

export type AllocationProblem =
  | { code: 'no_allocations'; message: string }
  | { code: 'no_account'; message: string; order: number }
  | { code: 'percent_sum'; message: string; sum: number }
  | { code: 'percent_range'; message: string; order: number }
  | { code: 'duplicate_account'; message: string; registryMtrl: number }
  | { code: 'no_total'; message: string };

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Ανοχή στο άθροισμα των ποσοστών: δεχόμαστε 33,33+33,33+33,34 αλλά όχι 99,9. */
const PERCENT_TOLERANCE = 0.005;

/**
 * Ελέγχει τον επιμερισμό ΠΡΙΝ υπολογιστούν ποσά. Επιστρέφει ΟΛΑ τα προβλήματα, όχι το πρώτο —
 * μια φόρμα που διορθώνει ένα λάθος τη φορά είναι βασανιστήριο.
 */
export function validateAllocations(
  allocations: readonly AllocationInput[],
  lineTotal: number | null | undefined,
): AllocationProblem[] {
  const problems: AllocationProblem[] = [];
  if (allocations.length === 0) {
    problems.push({ code: 'no_allocations', message: 'Δεν υπάρχει κανένας επιμερισμός.' });
    return problems;
  }
  if (lineTotal == null || !Number.isFinite(lineTotal)) {
    problems.push({ code: 'no_total', message: 'Η γραμμή δεν έχει σύνολο — δεν γίνεται επιμερισμός.' });
  }

  // ΠΡΩΤΑ ο λογαριασμός, μετά η αριθμητική. Ένας επιμερισμός που «κλείνει» στο 100 % αλλά δεν
  // λέει ΠΟΥ πάνε τα λεφτά δεν είναι επιμερισμός — και η πράσινη ένδειξη «κλείνει με το σύνολο»
  // πάνω από άδειους λογαριασμούς είναι χειρότερη από καμία ένδειξη: υπόσχεται ότι τελείωσες.
  allocations.forEach((a, i) => {
    if (!Number.isFinite(a.registryMtrl) || a.registryMtrl <= 0) {
      problems.push({
        code: 'no_account', order: i,
        message: `Δεν έχει επιλεγεί λογαριασμός στη γραμμή ${i + 1} του επιμερισμού.`,
      });
    }
  });

  allocations.forEach((a, i) => {
    if (!Number.isFinite(a.percent) || a.percent <= 0 || a.percent > 100) {
      problems.push({
        code: 'percent_range', order: i,
        message: `Ποσοστό εκτός ορίων στη θέση ${i + 1}: πρέπει να είναι πάνω από 0 και έως 100.`,
      });
    }
  });

  // Ο ίδιος λογαριασμός δύο φορές δεν είναι επιμερισμός — είναι μία γραμμή γραμμένη δύο φορές,
  // και στο ERP θα κατέληγε σε δύο πανομοιότυπες γραμμές που κανείς δεν μπορεί να ξεχωρίσει.
  const seen = new Set<number>();
  for (const a of allocations) {
    if (!Number.isFinite(a.registryMtrl) || a.registryMtrl <= 0) continue; // το λέει ήδη το `no_account`
    if (seen.has(a.registryMtrl)) {
      problems.push({
        code: 'duplicate_account', registryMtrl: a.registryMtrl,
        message: 'Ο ίδιος λογαριασμός εμφανίζεται πάνω από μία φορά — ένωσέ τους σε έναν επιμερισμό.',
      });
    }
    seen.add(a.registryMtrl);
  }

  const sum = allocations.reduce((t, a) => t + (Number.isFinite(a.percent) ? a.percent : 0), 0);
  if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
    problems.push({
      code: 'percent_sum', sum: round2(sum),
      message: `Τα ποσοστά αθροίζουν ${round2(sum)} % αντί για 100 %.`,
    });
  }
  return problems;
}

/**
 * Μετατρέπει ποσοστά σε ποσά που αθροίζουν ΑΚΡΙΒΩΣ στο σύνολο της γραμμής.
 *
 * Το υπόλοιπο στρογγυλοποίησης πάει ΟΛΟΚΛΗΡΟ στον τελευταίο επιμερισμό — όχι μοιρασμένο, γιατί
 * τότε δύο επιμερισμοί με το ίδιο ποσοστό θα έβγαζαν διαφορετικό ποσό χωρίς εξήγηση.
 *
 * Δεν επικυρώνει: καλείται ΜΕΤΑ το {@link validateAllocations}.
 */
export function computeAllocationAmounts(
  allocations: readonly AllocationInput[],
  lineTotal: number,
): AllocationLine[] {
  const total = round2(lineTotal);
  const out: AllocationLine[] = [];
  let assigned = 0;

  allocations.forEach((a, i) => {
    const isLast = i === allocations.length - 1;
    const amount = isLast ? round2(total - assigned) : round2((total * a.percent) / 100);
    if (!isLast) assigned = round2(assigned + amount);
    out.push({ ...a, order: i, amount });
  });

  return out;
}

/** Το ανάποδο: από ποσό σε ποσοστό — για να δείξει η φόρμα τι σημαίνει ένα ποσό που πληκτρολογήθηκε. */
export function percentOf(amount: number, lineTotal: number): number {
  if (!Number.isFinite(lineTotal) || lineTotal === 0) return 0;
  return Math.round((amount / lineTotal) * 1000000) / 10000;
}
