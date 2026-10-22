// lib/ocr/bulk-item-plan.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο).
//
// Η ΚΡΙΣΗ ΚΑΘΕ ΟΜΑΔΑΣ ΓΡΑΜΜΩΝ στη μαζική διευθέτηση «Είδη & έξοδα».
//
// ΓΙΑΤΙ ΔΕΝ ΕΙΝΑΙ ΕΝΑ ΚΟΥΜΠΙ «ΔΗΜΙΟΥΡΓΙΑ ΟΛΩΝ». Στα πραγματικά δεδομένα (141 ομάδες, 2026-10-11)
// υπάρχουν ΤΡΙΑ διαφορετικά είδη απόφασης, και το καθένα θέλει άλλη ενέργεια:
//   • εμπορεύματα (BESSEY: 29 εργαλεία προς πώληση)        → ΔΗΜΙΟΥΡΓΙΑ είδους, ένα ανά ομάδα
//   • συνδρομές/υπηρεσίες (άδειες Soft1)                     → ΔΗΜΙΟΥΡΓΙΑ υπηρεσίας ή εξόδου
//   • χρεώσεις σε σειρές πιστωτών (ZIM: Ναύλος, B/L FEE, VGM…) → ΑΝΤΙΣΤΟΙΧΙΣΗ πολλών γραμμών σε
//     ΜΙΑ υπάρχουσα χρεοπίστωση. Δέκα νέες χρεοπιστώσεις για δέκα χρεώσεις ενός ναυλωτή θα ήταν
//     δέκα νέοι λογαριασμοί γενικής — απόφαση λογιστή, όχι αυτόματο.
//
// ΤΙ ΠΡΟΕΠΙΛΕΓΕΤΑΙ: μόνο η δημιουργία όπου η κατηγορία είναι ΤΕΚΜΗΡΙΩΜΕΝΗ (από τη σειρά του
// παραστατικού). «Χωρίς κατηγορία» σημαίνει «δεν ξέρουμε» (βλ. `lib/ocr/line-kind.ts`) — και μια
// λάθος καρτέλα είδους μέσα στο ERP δεν σβήνεται από εδώ. Οι προτάσεις αντιστοίχισης ΦΑΙΝΟΝΤΑΙ
// αλλά δεν τσεκάρονται: ακόμη και η καλύτερη πραγματική πρόταση («Soft1 OpEn Business Units» →
// «Soft1 ERP Business Units», 0,81) είναι εικασία ομοιότητας, όχι απόδειξη.
import type { MatchKind } from '@/lib/ocr/line-match';

export type ItemAction = 'create' | 'match' | 'none';
export type ItemStatus = 'ready' | 'needs_kind' | 'needs_target';

export interface ItemTarget { kind: MatchKind; id: number; code: string | null; name: string | null; isService?: boolean }

export interface ItemPlanInput {
  key: string; afm: string; pattern: string; sample: string; supplier: string | null;
  code: string | null; category: MatchKind | null; lineCount: number; docCount: number;
  price: number | null;
  suggestion: (ItemTarget & { score: number }) | null;
}

export interface ItemPlanRow {
  key: string; afm: string; pattern: string; name: string; supplier: string | null;
  code: string | null; lineCount: number; docCount: number; price: number | null;
  kind: MatchKind | null;
  action: ItemAction;
  target: ItemTarget | null;
  /** Η πρόταση του συστήματος — φαίνεται ως επιλογή, δεν εφαρμόζεται μόνη της. */
  suggestion: (ItemTarget & { score: number }) | null;
  status: ItemStatus;
  reason: string;
  selected: boolean;
}

/** Οι χρεοπιστώσεις ΔΕΝ δημιουργούνται μαζικά — μόνο αντιστοιχίζονται. */
export const creatableKind = (k: MatchKind | null): boolean => k === 'product' || k === 'service' || k === 'expense';

export function planItemRow(g: ItemPlanInput): ItemPlanRow {
  const base = {
    key: g.key, afm: g.afm, pattern: g.pattern, name: g.sample.trim().slice(0, 200), supplier: g.supplier,
    code: g.code, lineCount: g.lineCount, docCount: g.docCount, price: g.price, kind: g.category,
    suggestion: g.suggestion, target: null,
  };
  if (g.category == null) {
    return { ...base, action: 'none', status: 'needs_kind', selected: false,
      reason: 'Χωρίς κατηγορία — διάλεξε μητρώο (είδος, υπηρεσία, έξοδο ή χρεοπίστωση).' };
  }
  if (g.category === 'lineitem') {
    return { ...base, action: 'match', status: 'needs_target', selected: false,
      reason: 'Χρεοπίστωση — αντιστοίχισε σε υπάρχουσα (δεν δημιουργούνται μαζικά νέοι λογαριασμοί).' };
  }
  return { ...base, action: 'create', status: 'ready', selected: true,
    reason: `Νέο ${KIND_LABEL[g.category].toLowerCase()} στο SoftOne, από τη γραμμή του τιμολογίου.` };
}

/**
 * Εφαρμογή μιας μαζικής επιλογής ΜΗΤΡΩΟΥ σε μια γραμμή. Επιστρέφει τη γραμμή με τη σωστή ενέργεια
 * για το νέο μητρώο: δημιουργήσιμο → δημιουργία· χρεοπίστωση → θέλει στόχο.
 */
export function withKind(r: ItemPlanRow, kind: MatchKind): ItemPlanRow {
  if (kind === 'lineitem') {
    return { ...r, kind, action: 'match', target: null, status: 'needs_target', selected: false,
      reason: 'Χρεοπίστωση — αντιστοίχισε σε υπάρχουσα.' };
  }
  return { ...r, kind, action: 'create', target: null, status: 'ready', selected: true,
    reason: `Νέο ${KIND_LABEL[kind].toLowerCase()} στο SoftOne, από τη γραμμή του τιμολογίου.` };
}

/** Εφαρμογή μαζικής ΑΝΤΙΣΤΟΙΧΙΣΗΣ σε ένα υπάρχον μητρώο. */
export function withTarget(r: ItemPlanRow, t: ItemTarget): ItemPlanRow {
  return { ...r, kind: t.kind, action: 'match', target: t, status: 'ready', selected: true,
    reason: `Αντιστοίχιση σε ${t.code ?? ''} ${t.name ?? ''}`.trim() };
}

export const KIND_LABEL: Record<MatchKind, string> = {
  product: 'Είδος', service: 'Υπηρεσία', expense: 'Κατηγορία εξόδου', lineitem: 'Κατηγορία εξόδου',
};

/**
 * Κωδικοί προμηθευτή που ΔΕΝ ταυτοποιούν είδος — ΟΛΟΙ οι κωδικοί ενός εκδότη που επαναλαμβάνει
 * έστω και έναν κωδικό σε διαφορετικές ομάδες του.
 *
 * Πραγματικό: η BESSEY τυπώνει ως «κωδικό» τη ΔΑΣΜΟΛΟΓΙΚΗ ΚΛΑΣΗ — 82057000 σε δεκάδες εργαλεία.
 * Η πρώτη εκδοχή αγνοούσε μόνο τους κωδικούς που επαναλαμβάνονται· έτσι το «82130000», που έτυχε
 * να εμφανίζεται σε ΜΙΑ ομάδα, θεωρήθηκε ταυτοποιητικό και ένα ψαλίδι γράφτηκε στο ERP με κωδικό
 * δασμολογικής κλάσης. Εκδότης που επαναλαμβάνει κωδικούς τυπώνει ΤΑΞΙΝΟΜΗΣΗ, όχι κωδικούς —
 * οπότε κανένας κωδικός του δεν χρησιμοποιείται, και ο κωδικός βγαίνει από την αρίθμηση.
 */
export function sharedSupplierCodes(groups: readonly { afm: string; code: string | null }[]): Set<string> {
  const n = new Map<string, number>();
  for (const g of groups) if (g.code) { const k = `${g.afm}|${g.code}`; n.set(k, (n.get(k) ?? 0) + 1); }
  const classifying = new Set([...n].filter(([, c]) => c > 1).map(([k]) => k.split('|')[0]));
  return new Set([...n.keys()].filter((k) => classifying.has(k.split('|')[0])));
}
