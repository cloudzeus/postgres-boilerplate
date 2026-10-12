// lib/ocr/expense-families.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// «Τι ΕΙΔΟΥΣ δαπάνη είναι αυτή η γραμμή — ναύλος, καύσιμο, συνδρομή λογισμικού, αμοιβή…;»
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ. Η μνήμη αντιστοιχίσεων έχει κλειδί (εκδότης, κείμενο γραμμής). Σε ένα demo με
// παραστατικά πελάτη ΚΑΘΕ εκδότης είναι καινούργιος, άρα η μνήμη δεν πιάνει ποτέ την πρώτη φορά.
// Όμως ο λογιστής δεν αποφασίζει ανά εκδότη: «ναύλος» πάει στα μεταφορικά αγορών είτε τον χρεώνει η
// ZIM είτε η LKW. Εδώ η γραμμή παίρνει ένα σταθερό κλειδί οικογένειας (`@family:freight@24`), και μία
// απόφαση ισχύει για κάθε επόμενο εκδότη. Ίδια ιδέα με τους λογαριασμούς κοινής ωφέλειας
// (`lib/ocr/utility-bills.ts`), χωρίς να χρειάζεται γνωστός πάροχος.
//
// ΑΚΡΙΒΕΙΑ ΠΡΙΝ ΑΠΟ ΚΑΛΥΨΗ. Μόνο λέξεις που δεν αφήνουν αμφιβολία. Ό,τι δεν αναγνωρίζεται μένει
// `null` — μια λάθος οικογένεια θα έστελνε σιωπηλά τη γραμμή σε λάθος λογαριασμό σε ΚΑΘΕ εκδότη.
// Είδη αποθήκης, πρώτες ύλες και πάγια ΔΕΝ είναι οικογένειες: εκεί η αντιστοίχιση είναι ανά είδος.
import { normalizeGreek } from './doc-type-classify';

export type ExpenseFamily =
  | 'customs' | 'courier' | 'freight' | 'fuel' | 'software' | 'hosting' | 'fees' | 'commission'
  | 'rent' | 'insurance' | 'repairs' | 'stationery' | 'travel' | 'meals';

export const EXPENSE_FAMILY_LABEL: Record<ExpenseFamily, string> = {
  customs: 'Εκτελωνιστικά',
  courier: 'Ταχυμεταφορές',
  freight: 'Ναύλοι & μεταφορικά',
  fuel: 'Καύσιμα',
  software: 'Λογισμικό & συνδρομές',
  hosting: 'Domains & φιλοξενία',
  fees: 'Αμοιβές τρίτων',
  commission: 'Προμήθειες',
  rent: 'Ενοίκια',
  insurance: 'Ασφάλιστρα',
  repairs: 'Επισκευές & συντήρηση',
  stationery: 'Γραφική ύλη',
  travel: 'Ταξίδια & μετακινήσεις',
  meals: 'Εστίαση & φιλοξενία',
};

// Σύντμηση ως αυτοτελής λέξη στο κανονικοποιημένο αλφάβητο (το `\b` της JS δεν πιάνει ελληνικά).
const w = (s: string) => `(?<![A-ZΑ-Ω0-9])(?:${s})(?![A-ZΑ-Ω0-9])`;

/**
 * Η ΣΕΙΡΑ ΜΕΤΡΑΕΙ: τα πιο ειδικά πρώτα. Εκτελωνιστικά πριν από τα μεταφορικά (ο εκτελωνιστής χρεώνει
 * και «μεταφορικά»), ταχυμεταφορές πριν από τα μεταφορικά, domains πριν από το λογισμικό.
 */
const RULES: [ExpenseFamily, RegExp][] = [
  ['customs', new RegExp(`ΕΚΤΕΛΩΝΙΣ|ΤΕΛΩΝΕΙ|CUSTOMS|ΔΑΣΜ|ΔΙΑΣΑΦΗΣ|CLEARANCE|${w('ΟΛΠ')}|${w('ΟΛΘ')}`)],
  ['courier', new RegExp(`COURIER|ΤΑΧΥΜΕΤΑΦΟΡ|ΑΠΟΣΤΟΛΗ ΔΕΜΑΤ|${w('ACS|DHL|UPS|FEDEX|ΕΛΤΑ')}|ΓΕΝΙΚΗ ΤΑΧΥΔΡΟΜ`)],
  ['freight', new RegExp(
    `ΝΑΥΛ|FREIGHT|ΜΕΤΑΦΟΡΑ|ΜΕΤΑΦΟΡΕΣ|ΜΕΤΑΦΟΡΙΚ|TRANSPORT|CARRIAGE|${w('B L FEE|BL FEE')}|BILL OF LADING|${w('VGM|THC')}`
    + `|RELEASE OF EMPTY|DEMURRAGE|DETENTION|STABILITY SURCHARGE|BUNKER|AGENCY FEE|CONTAINER|CONEX`,
  )],
  ['fuel', new RegExp(`ΑΜΟΛΥΒΔ|DIESEL|ΠΕΤΡΕΛΑΙΟ ΚΙΝΗΣ|ΒΕΝΖΙΝ|UNLEADED|${w('V ?POWER')}|ADBLUE|ΚΑΥΣΙΜΟ ΚΙΝΗΣ|${w('ΚΑΥΣΙΜΑ|ΚΑΥΣΙΜΟ')}`)],
  ['hosting', new RegExp(`${w('DOMAIN')}|ΟΝΟΜΑΤΟΣ ΧΩΡΟΥ|HOSTING|ΦΙΛΟΞΕΝΙΑ ΙΣΤΟΣΕΛ|${w('SSL')}|ΚΑΤΟΧΥΡΩΣΗ ΟΝΟΜ`)],
  ['software', new RegExp(
    `ΣΥΝΔΡΟΜΗ|ΣΥΝΔΡΟΜΗΣ|SUBSCRIPTION|LICEN[CS]E|ΑΔΕΙΑ ΧΡΗΣ|ΑΔΕΙΕΣ ΧΡΗΣ|${w('CLOUD|SAAS')}|CONNECTOR|ΛΟΓΙΣΜΙΚ|SOFTWARE`
    + `|RUN TIME RIGHTS|${w('SOFT1|ENTERSOFT|WOOCOMMERCE|WORDPRESS')}|OFFICE 365|MICROSOFT 365|GOOGLE WORKSPACE`,
  )],
  ['fees', new RegExp(`ΑΜΟΙΒΗ|ΑΜΟΙΒΕΣ|CONSULTING|ΣΥΜΒΟΥΛΕΥΤ|ΜΙΣΘΟΔΟΣΙ|PAYROLL|ΤΗΡΗΣΗ ΒΙΒΛΙ|ΛΟΓΙΣΤΙΚΕΣ ΥΠΗΡΕΣ|${w('AUDIT')}|ΕΛΕΓΚΤΙΚ`)],
  ['commission', new RegExp(`COMMISSION|ΠΡΟΜΗΘΕΙΑ ΜΕΣΙΤ|ΠΡΟΜΗΘΕΙΕΣ ΠΩΛΗΣ|ΠΡΟΜΗΘΕΙΑ ΠΩΛΗΣ|BROKERAGE`)],
  ['rent', new RegExp(`ΕΝΟΙΚΙΟ|ΕΝΟΙΚΙΑ|ΜΙΣΘΩΜΑ ΑΚΙΝ|${w('RENT')}`)],
  ['insurance', new RegExp(`ΑΣΦΑΛΙΣΤΡ|INSURANCE PREMIUM`)],
  ['repairs', new RegExp(`ΕΠΙΣΚΕΥ|ΣΥΝΤΗΡΗΣ|REPAIR|MAINTENANCE`)],
  ['stationery', new RegExp(`ΓΡΑΦΙΚΗ ΥΛΗ|ΓΡΑΦΙΚΗΣ ΥΛΗΣ|ΧΑΡΤΙ Α4|${w('TONER')}|ΜΕΛΑΝΙ`)],
  ['travel', new RegExp(`ΕΙΣΙΤΗΡΙ|ΑΕΡΟΠΟΡΙΚ|ΞΕΝΟΔΟΧ|ΔΙΑΜΟΝΗ|ΔΙΟΔΙ|${w('TOLL|TAXI|ΤΑΞΙ')}|ΣΤΑΘΜΕΥΣ|PARKING`)],
  ['meals', new RegExp(`ΕΣΤΙΑΣ|ΓΕΥΜΑ|ΦΑΓΗΤ|RESTAURANT`)],
];

/** Η οικογένεια δαπάνης μιας γραμμής — `null` όταν το κείμενο δεν είναι σαφές. */
export function classifyExpenseFamily(name: string | null | undefined): ExpenseFamily | null {
  const t = normalizeGreek(name ?? '');
  if (!t) return null;
  for (const [family, re] of RULES) if (re.test(t)) return family;
  return null;
}

/** Κλειδιά μνήμης, από το πιο ειδικό (με ΦΠΑ) στο πιο γενικό. Δεν συγκρούονται με κείμενο (`@`). */
export function familyMemoryKeys(family: ExpenseFamily, vatRate?: number | null): string[] {
  const base = `@family:${family}`;
  return vatRate == null || !Number.isFinite(vatRate) ? [base] : [`${base}@${vatRate}`, base];
}

/** «Ναύλοι & μεταφορικά · 24%» από ένα κλειδί μνήμης. */
export function familyMemoryKeyLabel(pattern: string): string | null {
  const m = /^@family:([a-z_]+)(?:@([\d.]+))?$/.exec(pattern);
  if (!m) return null;
  const label = EXPENSE_FAMILY_LABEL[m[1] as ExpenseFamily];
  return label ? `${label}${m[2] ? ` · ${m[2]}%` : ''}` : null;
}

/**
 * Πώς λέγεται κάθε οικογένεια μέσα στα ΜΗΤΡΩΑ του SoftOne (χρεοπιστώσεις, έξοδα, λογαριασμοί) —
 * για τις προτάσεις στόχου. Στο κανονικοποιημένο αλφάβητο (κεφαλαία, χωρίς τόνους).
 *
 * ΑΚΡΙΒΕΙΑ: «ΜΕΤΑΦΟΡΙΚΑ» ναι, «ΜΕΤΑΦΟΡΙΚΩΝ ΜΕΣΩΝ» όχι (ενοίκια/αποσβέσεις οχημάτων)· «ΛΟΓΙΣΜΙΚΟ»
 * ναι, σκέτο «ΣΥΝΔΡΟΜΕΣ» όχι (περιοδικά, σύλλογοι). Επαληθευμένο στα μητρώα του Demo S1.
 */
export const FAMILY_REGISTRY_HINT: Record<ExpenseFamily, RegExp> = {
  customs: /ΕΚΤΕΛΩΝΙΣΤ|ΤΕΛΩΝ|ΔΑΣΜ/,
  courier: /ΤΑΧΥΔΡΟΜ|ΤΑΧΥΜΕΤΑΦ|COURIER/,
  freight: /ΜΕΤΑΦΟΡΙΚΑ|ΝΑΥΛ|ΕΞΟΔΑ ΜΕΤΑΦ/,
  fuel: /ΚΑΥΣΙΜ|ΒΕΝΖΙΝ|ΠΕΤΡΕΛΑΙ/,
  software: /ΛΟΓΙΣΜΙΚ|ΑΔΕΙ\w* ΧΡΗΣ|ΜΗΧΑΝΟΓΡΑΦ|SOFTWARE/,
  hosting: /ΙΣΤΟΣΕΛΙΔ|HOSTING|ΔΙΑΔΙΚΤ|INTERNET|ΜΗΧΑΝΟΓΡΑΦ/,
  fees: /ΑΜΟΙΒ/,
  commission: /ΠΡΟΜΗΘΕΙ\w* (ΠΩΛ|ΤΡΙΤ|ΜΕΣΙΤ)|COMMISSION/,
  rent: /ΕΝΟΙΚΙ/,
  insurance: /ΑΣΦΑΛΙΣΤΡ/,
  repairs: /ΕΠΙΣΚΕΥ|ΣΥΝΤΗΡΗΣ/,
  stationery: /ΓΡΑΦΙΚΗ ΥΛΗ|ΕΝΤΥΠΑ|ΧΑΡΤΙΚ/,
  travel: /ΟΔΟΙΠΟΡΙΚ|ΔΙΑΜΟΝΗ|ΕΙΣΙΤΗΡ|ΤΑΞΙΔ|ΜΕΤΑΚΙΝΗΣ/,
  meals: /ΦΙΛΟΞΕΝΙ|ΕΣΤΙΑΣ|ΓΕΥΜΑ/,
};
