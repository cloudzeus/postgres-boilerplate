// lib/tax-office.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only): το χρησιμοποιούν και οι
// routes και το UI.
//
// Δ.Ο.Υ. του μητρώου ΑΑΔΕ → Δ.Ο.Υ. του SoftOne (πίνακας IRSDATA).
//
// **Ο κωδικός είναι το κλειδί.** Η ΑΑΔΕ δίνει τον επίσημο 4ψήφιο κωδικό (`basic_rec.doy`, π.χ.
// `1101`) και το SoftOne τον κρατά στο `IRSDATA.CODE` («Κωδ.Δ.Ο.Υ.»). Αντιστοίχιση γίνεται με
// ΑΚΡΙΒΗ σύγκριση κωδικού· μόνο όταν η ΑΑΔΕ δεν δίνει κωδικό πέφτουμε σε ΑΚΡΙΒΗ σύγκριση
// κανονικοποιημένης ονομασίας. Καμία «περιέχει»-σύγκριση: αυτή έστελνε σιωπηλά τη «ΙΑ΄ ΑΘΗΝΩΝ»
// στην «Α΄ ΑΘΗΝΩΝ» (το «Α ΑΘΗΝΩΝ» περιέχεται στο «ΙΑ ΑΘΗΝΩΝ»). Λάθος Δ.Ο.Υ. σε καρτέλα
// συναλλασσομένου είναι λάθος φορολογικό στοιχείο στον ERP — χειρότερο από ένα κενό πεδίο που
// ο χρήστης βλέπει.
//
// **Όταν δεν βρίσκεται, το λέμε — ποτέ δεν μαντεύουμε.** Ούτε «ΑΓΝΩΣΤΗ ΔΟΥ» (κωδ. 1) στη θέση
// της: αυτή είναι θετικός ισχυρισμός που θα στεκόταν στη θέση ενός «δεν ξέρω».

import { GREEK_LATIN_HOMOGLYPHS } from '@/lib/doc-reference';

/** Μία γραμμή του μητρώου Δ.Ο.Υ. του SoftOne (πίνακας IRSDATA). */
export interface TaxOffice {
  /**
   * `IRSDATA.IRSDATA` — το εσωτερικό κλειδί (Smallint). **Αυτό** γράφεται στο `TRDR.IRSDATA`:
   * το πεδίο της καρτέλας είναι selector με editor `IRSDATA`, δηλ. δείχνει στο κλειδί του πίνακα.
   */
  key: string;
  /** `IRSDATA.CODE` «Κωδ.Δ.Ο.Υ.» — ο επίσημος κωδικός ΑΑΔΕ. Με αυτόν γίνεται η αντιστοίχιση. */
  code: string;
  name: string;
  isActive: boolean;
}

/** Κωδικός Δ.Ο.Υ. → μορφή σύγκρισης: χωρίς κενά, και χωρίς αρχικά μηδενικά αν είναι αριθμός. */
export function normalizeTaxOfficeCode(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (/^\d+$/.test(s)) return s.replace(/^0+(?=\d)/, '');
  return s.toUpperCase();
}

/**
 * Ονομασία Δ.Ο.Υ. → μορφή σύγκρισης. Ίδια θεωρούνται:
 * - με ή χωρίς κεραία (`΄`, `'`, `ʹ`, `’`): «ΙΖ ΑΘΗΝΩΝ» = «ΙΖ΄ ΑΘΗΝΩΝ» (το SoftOne τα έχει ανάμεικτα)
 * - με ή χωρίς τόνους / διαλυτικά, πεζά ή κεφαλαία
 * - ελληνικά και λατινικά ομόγλυφα (Α/A, Ε/E, Ι/I…) — ο πίνακας του `lib/doc-reference.ts`
 * - με ή χωρίς πρόθεμα «Δ.Ο.Υ.», τελείες, παύλες, κενά (η μορφή σύγκρισης δεν έχει διαχωριστικά)
 *
 * ΔΕΝ «χαλαρώνει» τίποτε άλλο: «ΙΑ ΑΘΗΝΩΝ» και «Α ΑΘΗΝΩΝ» μένουν διαφορετικά.
 */
export function normalizeTaxOfficeName(v: unknown): string {
  const stripped = String(v ?? '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  let folded = '';
  for (const ch of stripped) folded += GREEK_LATIN_HOMOGLYPHS[ch] ?? ch;
  return folded
    // Πρόθεμα «Δ.Ο.Υ.» / «ΔΟΥ » (το Ο/Υ έχουν ήδη γίνει λατινικά O/Y).
    .replace(/^\s*Δ\s*\.?\s*O\s*\.?\s*Y(?:\s*\.|\s+)/, '')
    // ΧΩΡΙΣ κανένα διαχωριστικό (όπως και το `normalizeDocRef`): «Φ.Α.Ε.» = «ΦΑΕ», «Ν.ΙΩΝΙΑΣ» =
    // «Ν. ΙΩΝΙΑΣ», «Α΄ΠΕΙΡΑΙΑ» = «Α΄ ΠΕΙΡΑΙΑ». Τα γράμματα μένουν όλα: «ΙΑ…» ≠ «Α…».
    .replace(/[^0-9A-ZΑ-Ω]+/g, '');
}

/** Γιατί δεν αντιστοιχίστηκε μια Δ.Ο.Υ. */
export type TaxOfficeMissReason =
  /** Η ΑΑΔΕ έδωσε κωδικό που δεν υπάρχει στο `IRSDATA.CODE`. */
  | 'code_not_found'
  /** Χωρίς κωδικό· καμία ονομασία δεν ταιριάζει ακριβώς. */
  | 'name_not_found'
  /** Περισσότερες από μία γραμμές ταιριάζουν — δεν διαλέγουμε εμείς. */
  | 'ambiguous'
  /** Βρέθηκε, αλλά είναι ανενεργή στο SoftOne. */
  | 'inactive';

export type TaxOfficeResolution =
  | { status: 'matched'; by: 'code' | 'name'; office: TaxOffice }
  | { status: 'missing'; reason: TaxOfficeMissReason; code: string | null; descr: string | null; note: string }
  /** Η πηγή δεν έδωσε καθόλου Δ.Ο.Υ. (ούτε κωδικό ούτε ονομασία). */
  | { status: 'empty' };

/** «Η Δ.Ο.Υ. ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (κωδ. 1190)» — ή όσο από αυτό ξέρουμε. */
function officeLabel(descr: string | null, code: string | null): string {
  const d = descr?.trim();
  const c = code?.trim();
  return `Η Δ.Ο.Υ.${d ? ` ${d}` : ''}${c ? ` (κωδ. ${c})` : ''}`;
}

/** Το ορατό μήνυμα όταν η Δ.Ο.Υ. δεν αντιστοιχίζεται. Πάντα ονομάζει τη Δ.Ο.Υ. και τον κωδικό της. */
export function taxOfficeMissingNote(
  reason: TaxOfficeMissReason,
  descr: string | null,
  code: string | null,
): string {
  const label = officeLabel(descr, code);
  switch (reason) {
    case 'ambiguous':
      return `${label} αντιστοιχεί σε περισσότερες από μία Δ.Ο.Υ. του μητρώου SoftOne — επιλέξτε τη χειροκίνητα.`;
    case 'inactive':
      return `${label} είναι ανενεργή στο μητρώο Δ.Ο.Υ. του SoftOne.`;
    default:
      return `${label} δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.`;
  }
}

function missing(
  reason: TaxOfficeMissReason, descr: string | null, code: string | null,
): TaxOfficeResolution {
  return { status: 'missing', reason, code, descr, note: taxOfficeMissingNote(reason, descr, code) };
}

function pick(
  hits: TaxOffice[], by: 'code' | 'name', descr: string | null, code: string | null,
  notFound: TaxOfficeMissReason,
): TaxOfficeResolution {
  if (hits.length === 0) return missing(notFound, descr, code);
  if (hits.length > 1) {
    // Αν ακριβώς μία από τις διπλές είναι ενεργή, αυτή είναι η μόνη επιλέξιμη.
    const active = hits.filter((o) => o.isActive);
    if (active.length === 1) return { status: 'matched', by, office: active[0] };
    return missing('ambiguous', descr, code);
  }
  const [office] = hits;
  if (!office.isActive) return missing('inactive', descr, code);
  return { status: 'matched', by, office };
}

/**
 * Η Δ.Ο.Υ. μιας πηγής (ΑΑΔΕ: κωδικός + ονομασία· OCR: μόνο ονομασία) → γραμμή του IRSDATA.
 *
 * 1. Με κωδικό: ΜΟΝΟ ακριβής σύγκριση κωδικού. Κωδικός που δεν υπάρχει ⇒ `missing` — ΔΕΝ πέφτουμε
 *    σε ονομασία: ο κωδικός είναι ο επίσημος ορισμός, και μια ονομασία που «μοιάζει» δεν τον αναιρεί.
 * 2. Χωρίς κωδικό: ακριβής σύγκριση κανονικοποιημένης ονομασίας ({@link normalizeTaxOfficeName}).
 * 3. Τίποτα από τα δύο ⇒ `empty`.
 */
export function resolveTaxOffice(
  input: { code?: string | null; descr?: string | null },
  offices: readonly TaxOffice[],
): TaxOfficeResolution {
  const code = String(input.code ?? '').trim() || null;
  const descr = String(input.descr ?? '').replace(/\s+/g, ' ').trim() || null;

  if (code) {
    const target = normalizeTaxOfficeCode(code);
    const hits = offices.filter((o) => o.code && normalizeTaxOfficeCode(o.code) === target);
    return pick(hits, 'code', descr, code, 'code_not_found');
  }
  if (descr) {
    const target = normalizeTaxOfficeName(descr);
    if (!target) return { status: 'empty' };
    const hits = offices.filter((o) => normalizeTaxOfficeName(o.name) === target);
    return pick(hits, 'name', descr, null, 'name_not_found');
  }
  return { status: 'empty' };
}

// ── Ανάγνωση του IRSDATA ────────────────────────────────────────────────────────────────────────

/** Ό,τι επιστρέφει το `GetTable` (το `model[0]` περιγράφει τις στήλες ΜΕ ΤΗ ΣΕΙΡΑ ΠΟΥ ΗΡΘΑΝ). */
export interface GetTableTaxOfficesResponse {
  success?: boolean;
  error?: string;
  errorcode?: number;
  count?: number;
  model?: { name?: string }[][];
  data?: unknown[][];
}

/** Οι στήλες που ζητάμε από το IRSDATA. */
export const TAX_OFFICE_FIELDS = ['IRSDATA', 'CODE', 'NAME', 'ISACTIVE'] as const;

/**
 * Η απάντηση `GetTable IRSDATA` → {@link TaxOffice}[], **κατά όνομα στήλης** από το `model`,
 * ποτέ κατά θέση: το GetTable μπορεί να αλλάξει σειρά ή να προσθέσει στήλες (το έκανε στο ACNT).
 * Λείπει κάποια από τις IRSDATA / CODE / NAME ⇒ σφάλμα (χωρίς CODE δεν υπάρχει ασφαλής αντιστοίχιση).
 * Και αρνείται «κοντή» απάντηση (`count` ≠ γραμμές): ένα μισό μητρώο θα έβγαζε ψευδή «δεν υπάρχει».
 */
export function parseTaxOfficesResponse(res: GetTableTaxOfficesResponse): TaxOffice[] {
  if (res.success === false) {
    throw new Error(`GetTable IRSDATA απέτυχε: ${res.error ?? `code ${res.errorcode ?? '?'}`}`);
  }
  const cols = (res.model?.[0] ?? []).map((m) => String(m?.name ?? '').toUpperCase());
  const at = (f: string) => cols.indexOf(f);
  for (const f of ['IRSDATA', 'CODE', 'NAME']) {
    if (at(f) < 0) throw new Error(`GetTable IRSDATA: λείπει η στήλη ${f} από την απάντηση`);
  }
  const cell = (r: unknown[], f: string): string => {
    const i = at(f);
    return i < 0 || r?.[i] == null ? '' : String(r[i]).trim();
  };
  const data = res.data ?? [];
  if (typeof res.count === 'number' && res.count !== data.length) {
    throw new Error(`GetTable IRSDATA: δηλώνει ${res.count} Δ.Ο.Υ. αλλά επέστρεψε ${data.length} — ελλιπής απάντηση`);
  }
  return data
    .map((r) => ({
      key: cell(r, 'IRSDATA'),
      code: cell(r, 'CODE'),
      // Το SoftOne αφήνει κάποτε διπλά κενά / κενά στο τέλος.
      name: cell(r, 'NAME').replace(/\s+/g, ' '),
      // Στήλη που δεν ήρθε = δεν ξέρουμε ⇒ ενεργή (όπως και τα υπόλοιπα μητρώα).
      isActive: cell(r, 'ISACTIVE') !== '0',
    }))
    .filter((o) => o.key !== '' && o.name !== '');
}

// ── Το αποτέλεσμα όπως το βλέπει το UI ─────────────────────────────────────────────────────────

/** Όταν δεν διαβάστηκε καν το IRSDATA: άγνωστο — ΟΧΙ «δεν υπάρχει». */
export const TAX_OFFICES_UNAVAILABLE_NOTE =
  'Δεν ήταν δυνατή η ανάγνωση του μητρώου Δ.Ο.Υ. του SoftOne — η Δ.Ο.Υ. δεν αντιστοιχίστηκε.';

/**
 * Η Δ.Ο.Υ. του SoftOne για μια εγγραφή ΑΑΔΕ, έτοιμη για JSON / UI.
 * - `matched`: `office` είναι η γραμμή του IRSDATA (στέλνεται το `office.key`).
 * - `missing`: η ΑΑΔΕ έδωσε Δ.Ο.Υ. που το SoftOne δεν έχει (ή δεν ξεχωρίζει) — το πεδίο μένει ΚΕΝΟ
 *   και το `note` λέει ποια.
 * - `empty`: η ΑΑΔΕ δεν έδωσε Δ.Ο.Υ. — τίποτα να γραφτεί ή να σβηστεί.
 * - `unavailable`: το IRSDATA δεν διαβάστηκε — δεν ξέρουμε, άρα δεν αγγίζουμε τίποτα.
 */
export interface TaxOfficeMapping {
  status: 'matched' | 'missing' | 'empty' | 'unavailable';
  by: 'code' | 'name' | null;
  office: TaxOffice | null;
  note: string | null;
}

export function toTaxOfficeMapping(r: TaxOfficeResolution): TaxOfficeMapping {
  if (r.status === 'matched') return { status: 'matched', by: r.by, office: r.office, note: null };
  if (r.status === 'missing') return { status: 'missing', by: null, office: null, note: r.note };
  return { status: 'empty', by: null, office: null, note: null };
}

export const UNAVAILABLE_TAX_OFFICE_MAPPING: TaxOfficeMapping = {
  status: 'unavailable', by: null, office: null, note: TAX_OFFICES_UNAVAILABLE_NOTE,
};
