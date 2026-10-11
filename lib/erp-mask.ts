// lib/erp-mask.ts — ΚΑΘΑΡΟ. Η ΜΑΣΚΑ ΚΩΔΙΚΟΥ που επιβάλλει το ίδιο το SoftOne.
//
// ΓΙΑΤΙ. Η πρόταση κωδικού συμπεραίνει το μοτίβο από τους ΥΠΑΡΧΟΝΤΕΣ κωδικούς. Στο Demo S1 η
// πλειονότητα των ειδών κουβαλά παλιούς 14ψήφιους κωδικούς (barcode), οπότε προτεινόταν
// «97861883881117» — και το ERP απέρριπτε ΚΑΘΕ δημιουργία με «Ο κωδικός πρέπει να είναι της
// μορφής nnnnnnnnn». Τα δεδομένα έλεγαν ένα πράγμα, ο κανόνας του ERP άλλο· ο κανόνας κερδίζει.
//
// Η μάσκα ΔΕΝ ρυθμίζεται με το χέρι: το ERP τη λέει στο μήνυμα απόρριψης και η εφαρμογή τη
// μαθαίνει (`parseErpMaskError`), μία φορά ανά μητρώο.

/** Σύμβολα μάσκας SoftOne → τι δέχεται η θέση. Ό,τι άλλο είναι κυριολεκτικός χαρακτήρας. */
const DIGIT = new Set(['n', 'N', '9', '0', '#']);
const LETTER = new Set(['a', 'A', 'L', 'l']);
const ANY = new Set(['x', 'X', '*', '?', 'c', 'C']);

/**
 * Δέχεται η μάσκα αυτόν τον κωδικό; Κάθε χαρακτήρας ελέγχεται απέναντι στη θέση του· ο κωδικός
 * μπορεί να είναι ΚΟΝΤΥΤΕΡΟΣ από τη μάσκα (μετρημένο: το «82130000», 8 ψηφία, έγινε δεκτό από
 * «nnnnnnnnn»), ποτέ μακρύτερος.
 */
export function erpMaskAccepts(mask: string | null | undefined, code: string | null | undefined): boolean {
  const m = String(mask ?? '').trim();
  const c = String(code ?? '').trim();
  if (!m) return true;                 // άγνωστη μάσκα = κανένας περιορισμός
  if (!c || c.length > m.length) return false;
  for (let i = 0; i < c.length; i++) {
    const p = m[i], ch = c[i];
    if (DIGIT.has(p)) { if (!/\d/.test(ch)) return false; }
    else if (LETTER.has(p)) { if (!/\p{L}/u.test(ch)) return false; }
    else if (ANY.has(p)) { /* οτιδήποτε */ }
    else if (p !== ch) return false;
  }
  return true;
}

/** Η μάσκα από το μήνυμα απόρριψης του SoftOne («…πρέπει να είναι της μορφής nnnnnnnnn»). */
export function parseErpMaskError(message: string | null | undefined): string | null {
  const m = /της\s+μορφής\s+([^\s,;]+?)\.?(?:\s|$)/i.exec(String(message ?? ''));
  return m ? m[1] : null;
}

/** Το setting όπου αποθηκεύεται η μάσκα που έμαθε η εφαρμογή, ανά μητρώο. */
export const itemErpMaskKey = (kind: string) => `softone.itemErpMask.${kind}`;
