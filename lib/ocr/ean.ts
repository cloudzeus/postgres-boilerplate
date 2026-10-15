// lib/ocr/ean.ts — ΚΑΘΑΡΟ. Barcode (EAN-8 / UPC-A / EAN-13 / GTIN-14) με έλεγχο ψηφίου ελέγχου.
//
// Ο κωδικός μιας γραμμής τιμολογίου είναι συχνά το ίδιο το barcode (13 ψηφία). Τότε πάει στο
// `ITEM.CODE1` («Κωδ.Barcode») — όχι στον κωδικό του είδους, που ακολουθεί τη «Μορφή κωδικού».

/** Έγκυρο GTIN (8/12/13/14 ψηφία, σωστό ψηφίο ελέγχου mod-10). */
export function isValidGtin(value: string | null | undefined): boolean {
  const s = String(value ?? '').replace(/\s+/g, '');
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return false;
  const digits = s.split('').map(Number);
  const check = digits.pop()!;
  // Από δεξιά: βάρη 3,1,3,1… (το ψηφίο ελέγχου έχει ήδη αφαιρεθεί).
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Το barcode μιας γραμμής: το διαβασμένο EAN αν είναι έγκυρο, αλλιώς ο κωδικός της αν είναι έγκυρο GTIN. */
export function lineEan(ean: string | null | undefined, code: string | null | undefined): string | null {
  const a = String(ean ?? '').replace(/\s+/g, '');
  if (a && isValidGtin(a)) return a;
  const c = String(code ?? '').replace(/\s+/g, '');
  return c && isValidGtin(c) ? c : null;
}
