// lib/ocr/example.ts — ISOMORPHIC, ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// Ένα ΕΠΙΒΕΒΑΙΩΜΕΝΟ έγγραφο του ίδιου εκδότη είναι ο καλύτερος οδηγός για το πού κάθονται τα πεδία
// στο χαρτί του: ποιο μπλοκ είναι ο εκδότης, πού μπαίνει η σειρά, πώς γράφεται η ημερομηνία. Δεν
// στέλνουμε όμως ολόκληρο το έγγραφο στο prompt — ένα τιμολόγιο με 80 γραμμές θα έπνιγε την
// πραγματική εικόνα και θα πλήρωνε tokens για το τίποτα. Εδώ μένει ΜΟΝΟ ο σκελετός:
//   • η ταυτότητα (τύπος/σειρά/αριθμός, ημερομηνία, νόμισμα),
//   • ο εκδότης ολόκληρος και από τον παραλήπτη μόνο επωνυμία + ΑΦΜ,
//   • σύνολα, ανάλυση ΦΠΑ, ψηφιακή σήμανση, πληρωμή (έως 2 IBAN), αναφορές,
//   • ΤΟ ΠΟΛΥ 3 γραμμές, ως δείγμα του πώς είναι φτιαγμένος ο πίνακας.
import type { DocumentJson } from '@/lib/ocr/canonical';

/** Ανώτατο μέγεθος του παραδείγματος σε χαρακτήρες JSON — σκληρό όριο, όχι σύσταση. */
export const EXAMPLE_MAX_CHARS = 4000;

/** Πόσες γραμμές κρατάμε στην καλύτερη περίπτωση. */
export const EXAMPLE_MAX_LINES = 3;

type Dict = Record<string, unknown>;

const isNil = (v: unknown) =>
  v == null || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Dict).length === 0);

/** Ό,τι είναι κενό φεύγει — και ένα αντικείμενο που έμεινε άδειο φεύγει κι αυτό. */
function prune(obj: Dict): Dict | null {
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const inner = prune(v as Dict);
      if (inner) out[k] = inner;
      continue;
    }
    if (!isNil(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

const pick = <T extends Dict>(src: T, keys: readonly (keyof T)[]): Dict => {
  const out: Dict = {};
  for (const k of keys) out[k as string] = src[k];
  return out;
};

/**
 * Κανονικό έγγραφο → συμπυκνωμένο παράδειγμα αναφοράς για το prompt.
 *
 * Η σειρά με την οποία πέφτουν κομμάτια όταν το JSON δεν χωράει στο όριο είναι σκόπιμη: πρώτα οι
 * γραμμές (η επανάληψη με τη μικρότερη αξία ανά χαρακτήρα), μετά οι αναφορές και η πληρωμή, και
 * ΠΟΤΕ η ταυτότητα του εκδότη ή τα σύνολα — αυτά ακριβώς είναι που θέλουμε να μάθει το μοντέλο.
 */
export function trimExample(document: DocumentJson): unknown {
  const base: Dict = {
    kind: document.kind,
    type: pick(document.type, ['label', 'series', 'number']),
    date: document.date,
    currency: document.currency,
    issuer: pick(document.issuer, ['name', 'vat', 'doy', 'address', 'city', 'zip', 'country', 'phone', 'email']),
    recipient: pick(document.recipient, ['name', 'vat']),
    totals: { ...document.totals },
    vatBreakdown: document.vatBreakdown.map((r) => ({ ...r })),
    digital: pick(document.digital, ['mark', 'uid', 'provider']),
  };

  const payment: Dict = {
    method: document.payment.method,
    terms: document.payment.terms,
    ibans: document.payment.ibans.slice(0, 2).map((r) => ({ bank: r.bank, iban: r.iban })),
  };
  const references: Dict = {
    orderNo: document.references.orderNo,
    deliveryNote: document.references.deliveryNote,
    period: document.references.period,
  };
  const lines = document.lines
    .slice(0, EXAMPLE_MAX_LINES)
    .map((l) => pick(l, ['code', 'name', 'unit', 'quantity', 'unitPrice', 'vatRate', 'net']));

  // Κάθε υποψήφιο, από το πιο θυσιάσιμο προς το πιο πολύτιμο.
  const build = (keep: { lines: number; extras: boolean }): Dict => {
    const out: Dict = { ...base };
    if (keep.extras) {
      out.payment = payment;
      out.references = references;
    }
    if (keep.lines > 0) out.lines = lines.slice(0, keep.lines);
    return prune(out) ?? { issuer: { name: document.issuer.name } };
  };

  const attempts = [
    { lines: EXAMPLE_MAX_LINES, extras: true },
    { lines: 2, extras: true },
    { lines: 1, extras: true },
    { lines: 0, extras: true },
    { lines: 0, extras: false },
  ];
  for (const attempt of attempts) {
    const candidate = build(attempt);
    if (JSON.stringify(candidate).length <= EXAMPLE_MAX_CHARS) return candidate;
  }
  // Ακόμη και γυμνό δεν χώρεσε (π.χ. τερατώδης επωνυμία ή ετικέτα): κρατάμε την ταυτότητα, με τα
  // κείμενα κομμένα, ώστε το όριο να είναι ΕΓΓΥΗΣΗ και όχι ευχή.
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
  const bare = prune({
    kind: document.kind,
    type: { label: clip(document.type.label, 80), number: clip(document.type.number, 40) },
    issuer: { name: clip(document.issuer.name, 120), vat: clip(document.issuer.vat, 20) },
    totals: pick(document.totals, ['net', 'vatAmount', 'total']),
  }) ?? { kind: document.kind };
  return bare;
}
