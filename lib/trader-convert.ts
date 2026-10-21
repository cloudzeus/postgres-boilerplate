// «Μετατροπή» πιστωτή σε προμηθευτή (και αντίστροφα) — καθαρό module (χωρίς I/O).
//
// ΓΙΑΤΙ ΔΕΝ ΑΛΛΑΖΕΙ ΑΠΛΩΣ ΤΟ SODTYPE. Στη SoftOne κάθε τύπος συναλλασσομένου είναι ΞΕΧΩΡΙΣΤΗ
// καρτέλα στον ίδιο πίνακα TRDR, και το SODTYPE το ορίζει το object που τη γράφει (SUPPLIER = 12,
// CREDITOR = 16). Μετρημένο στη Demo (21/10/2026): `getData` του object SUPPLIER με KEY καρτέλας
// πιστωτή απαντά «Selected record with key: 245 not found!» — το object δεν βλέπει καν την καρτέλα,
// άρα δεν μπορεί και να την αλλάξει. Το ίδιο ισχύει στο UI της SoftOne.
//
// Άρα «μετατροπή» = ΝΕΑ καρτέλα του άλλου τύπου με τα στοιχεία της παλιάς. Η παλιά μένει με το
// ιστορικό και τα υπόλοιπά της (τα παραστατικά της δεν μεταφέρονται — είναι λογιστικά γεγονότα)·
// προαιρετικά απενεργοποιείται, ώστε να μην επιλέγεται πια.
import type { TraderValues } from '@/lib/trader-update';

export type ConvertKind = 'supplier' | 'creditor';

export interface ConversionRoute {
  to: ConvertKind;
  toSodtype: number;
  /** Το object της ΠΗΓΗΣ (για την προαιρετική απενεργοποίηση). */
  fromObject: 'CREDITOR' | 'SUPPLIER';
  fromLabel: string;
  toLabel: string;
  /** Αιτιατική/γενική («Μετατροπή σε προμηθευτή», «καρτέλα πιστωτή»). */
  toAcc: string;
  fromAcc: string;
}

/** Ποιοι τύποι μετατρέπονται και σε τι. Πελάτες, χρεώστες και χρηματικοί λογαριασμοί όχι. */
export const CONVERSION_BY_SODTYPE: Record<number, ConversionRoute> = {
  16: { to: 'supplier', toSodtype: 12, fromObject: 'CREDITOR', fromLabel: 'Πιστωτής', toLabel: 'Προμηθευτής', toAcc: 'προμηθευτή', fromAcc: 'πιστωτή' },
  12: { to: 'creditor', toSodtype: 16, fromObject: 'SUPPLIER', fromLabel: 'Προμηθευτής', toLabel: 'Πιστωτής', toAcc: 'πιστωτή', fromAcc: 'προμηθευτή' },
};

/** Πεδία της καρτέλας-πηγής εκτός της φόρμας τροποποίησης, που ισχύουν και στον νέο τύπο. */
export interface ConversionExtra { vatStatus?: string | null; payment?: string | null; currency?: string | null }

const t = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

/** Τα ορίσματα δημιουργίας της νέας καρτέλας, από τη ΖΩΝΤΑΝΗ ανάγνωση της παλιάς. */
export function conversionInput(values: TraderValues, extra: ConversionExtra, code: string | null) {
  return {
    name: t(values.name) ?? '',
    afm: t(values.afm) ?? '',
    code: t(code),
    irsData: t(values.irsData),
    profession: t(values.profession),
    address: t(values.address),
    district: t(values.district),
    zip: t(values.zip),
    city: t(values.city),
    phone: t(values.phone),
    phone2: t(values.phone2),
    fax: t(values.fax),
    email: t(values.email),
    webpage: t(values.webpage),
    // Ο ISO κωδικός δεν χρειάζεται: η χώρα της παλιάς καρτέλας είναι ήδη το id της SoftOne.
    country: '',
    countryId: t(values.country),
    latitude: null,
    longitude: null,
    kad: values.kad ?? null,
    kad1: values.kad1 ?? null,
    vatStatus: t(extra.vatStatus),
    payment: t(extra.payment),
    currency: t(extra.currency),
  };
}

/** Ό,τι εμποδίζει τη μετατροπή, σε ελληνικά. Κενό = μπορεί να γίνει. */
export function conversionErrors(sodtype: number, values: TraderValues, code: string | null): string[] {
  const out: string[] = [];
  if (!CONVERSION_BY_SODTYPE[sodtype]) out.push('Μόνο πιστωτές και προμηθευτές μετατρέπονται.');
  if (!t(values.name)) out.push('Η καρτέλα δεν έχει επωνυμία.');
  const c = t(code);
  if (c && c.length > 25) out.push('Ο κωδικός είναι έως 25 χαρακτήρες.');
  return out;
}
