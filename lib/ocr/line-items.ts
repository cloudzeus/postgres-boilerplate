// lib/ocr/line-items.ts
// Οι ΓΡΑΜΜΕΣ του παραστατικού όπως τις δουλεύει η φόρμα του επεξεργαστή.
//
// ΓΙΑΤΙ ΖΕΙ ΕΔΩ ΚΑΙ ΟΧΙ ΜΕΣΑ ΣΤΟ `row-detail.tsx`: κάθε πεδίο της γραμμής δένεται σε ένα
// **controlled** `<input>`. Αν ένα πεδίο βγει `undefined`, το React γυρίζει το input σε
// uncontrolled και βγάζει το γνωστό «A component is changing a controlled input to be
// uncontrolled». Η εγγύηση «ΚΑΘΕ πεδίο είναι πάντα string» είναι λοιπόν προδιαγραφή, όχι
// σύμπτωση — και μια προδιαγραφή θέλει test, άρα ο κώδικας πρέπει να είναι εισαγώγιμος από
// τα vitest (`lib/**`) χωρίς να σύρει μαζί του ένα ολόκληρο client component.

/** Η γραμμή όπως τη δουλεύει η φόρμα: ΟΛΑ τα πεδία κείμενο, ΠΟΤΕ `undefined`. */
export interface LineItem {
  code: string; name: string; unit: string; quantity: string; price: string;
  discount: string; vatRate: string; total: string;
  /**
   * Ό,τι διάβασε ένα πρότυπο για ΑΥΤΗ τη γραμμή. Ταξιδεύει ΜΑΖΙ της: αν το ξαναβρίσκαμε κάθε
   * φορά από το `data.items[i]`, μια προσθήκη ή διαγραφή γραμμής θα μετακινούσε τους δείκτες
   * και τα ειδικά πεδία θα κατέληγαν σε άλλο είδος.
   */
  customFields?: Record<string, unknown>;
}

export const EMPTY_LINE: LineItem = {
  code: '', name: '', unit: '', quantity: '', price: '', discount: '', vatRate: '', total: '',
};

/** Τα πεδία που εμφανίζονται ως κείμενο σε input — ό,τι μπει εδώ, μπαίνει και στο `EMPTY_LINE`. */
const TEXT_FIELDS = [
  'code', 'name', 'unit', 'quantity', 'price', 'discount', 'vatRate', 'total',
] as const satisfies readonly (keyof LineItem)[];

/** `null`/`undefined` → κενό· οτιδήποτε άλλο (αριθμός, boolean…) → η κειμενική του μορφή. */
function text(v: unknown): string {
  return v != null ? String(v) : '';
}

/**
 * Φέρνει τις γραμμές μιας εξαγωγής στη μορφή της φόρμας.
 *
 * Δέχεται ΚΑΘΕ σχήμα που μπορεί να έχει γράψει παλιότερη εξαγωγή — γραμμές με λιγότερα πεδία,
 * `null` τιμές, αριθμούς αντί για κείμενο, ακόμη και στοιχεία που δεν είναι αντικείμενα — και
 * βγάζει πάντα πλήρεις γραμμές.
 */
export function toLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  // `Array.from` αντί για `raw.map`: το `map` ΔΙΑΤΗΡΕΙ τις τρύπες ενός αραιού πίνακα, οπότε θα
  // κατέληγαν `undefined` γραμμές που σκάνε στο render.
  return Array.from(raw, (it) => {
    const src = (it ?? {}) as Record<string, unknown>;
    // Ξεκινάμε ΑΠΟ το `EMPTY_LINE`: ό,τι πεδίο προστεθεί αύριο στο `LineItem` παίρνει κι αυτό
    // αυτόματα την κενή του τιμή, αντί να θυμάται κανείς να γράψει ένα ακόμη `?? ''`.
    const line: LineItem = { ...EMPTY_LINE };
    for (const f of TEXT_FIELDS) line[f] = text(src[f]);
    if (src.customFields && typeof src.customFields === 'object') {
      line.customFields = src.customFields as Record<string, unknown>;
    }
    return line;
  });
}
