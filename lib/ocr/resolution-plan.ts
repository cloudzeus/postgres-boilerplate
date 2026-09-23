// lib/ocr/resolution-plan.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// «Τι ακριβώς πρέπει να λύσει ο χρήστης σε ΑΥΤΟ το παραστατικό, και σε ΠΟΙΟ μητρώο» — μία πηγή
// αλήθειας, κοινή για τον server (έλεγχοι, μπλοκαρίσματα) και για το client UI (λωρίδα ελέγχων,
// picker γραμμής).
//
// ΤΟ ΠΡΟΒΛΗΜΑ ΠΟΥ ΛΥΝΕΙ. Η σελίδα του παραστατικού ήξερε ήδη πού καταχωρείται το έγγραφο
// («Προορισμός: Ειδικές συναλλαγές πιστωτών · γραμμές LINLINES») αλλά **δεν το χρησιμοποιούσε
// στις ενέργειες**: η λωρίδα πρότεινε πάντα «Προμηθευτή» (ακόμη και σε παραστατικό πιστωτών, που
// θα γεννούσε `trader_kind_mismatch`), και ο μόνος inline δημιουργός έφτιαχνε πάντα είδος ή
// υπηρεσία (`MTRL` 51/52) — κάτι που μια γραμμή `LINLINES` **δεν μπορεί να δεχτεί ποτέ**. Ο
// χρήστης δηλαδή μπορούσε να κάνει όλη τη δουλειά και να μείνει μπλοκαρισμένος.
//
// Ο κανόνας είναι ο ίδιος με όλο τον αγωγό: **χωρίς απόδειξη, καμία δήλωση**. Άγνωστη ή μη
// υποστηριζόμενη σειρά ⇒ `null` / κενή λίστα, ΟΧΙ μια προεπιλογή «προμηθευτής» ή «είδος».

import type { MatchKind } from '@/lib/ocr/line-match';
import {
  SODTYPE_FOR_OBJECT,
  TRADER_KIND_FOR_OBJECT,
  TRADER_KIND_TEXT,
  type PostObject,
  type PostLineTable,
  type PostingTarget,
  type TraderKindName,
} from '@/lib/ocr/posting-target';

/** Ο τύπος καρτέλας που δέχεται η κεφαλίδα αυτού του παραστατικού. */
export interface RequiredTrader {
  kind: TraderKindName;
  /** `TRDR.SODTYPE` (12 προμηθευτής · 16 πιστωτής · 15 χρεώστης). */
  sodtype: number;
  /** «πιστωτής» — ονομαστική, για προτάσεις. */
  label: string;
  /** «πιστωτή» — αιτιατική, για «Δημιουργία πιστωτή». */
  labelAcc: string;
  /** «ΠΙΣΤΩΤΗΣ» — για το chip της λωρίδας. */
  chip: string;
  /** Το object καταχώρισης που το επέβαλε — η αιτιολογία που δείχνουμε. */
  object: PostObject;
}

/**
 * Ο απαιτούμενος τύπος καρτέλας από τον προορισμό. `null` = **δεν ξέρουμε** (άγνωστη ή μη
 * υποστηριζόμενη σειρά) — τότε το UI δεν προσφέρει ούτε σύνδεση ούτε δημιουργία, γιατί και τα
 * δύο θα ήταν εικασία που καταλήγει σε λάθος καρτέλα μέσα στο ERP.
 */
export function requiredTraderForTarget(target: PostingTarget | null | undefined): RequiredTrader | null {
  if (!target?.supported) return null;
  const kind = TRADER_KIND_FOR_OBJECT[target.object];
  if (!kind) return null;
  const t = TRADER_KIND_TEXT[kind];
  return {
    kind,
    sodtype: SODTYPE_FOR_OBJECT[target.object],
    label: t.nom,
    labelAcc: t.acc,
    chip: t.chip,
    object: target.object,
  };
}

/** Ελληνικά ονόματα των τεσσάρων μητρώων γραμμής — ίδια λέξη με το chip του πίνακα γραμμών. */
export const LINE_KIND_LABEL: Record<MatchKind, string> = {
  product: 'Είδος',
  service: 'Υπηρεσία',
  expense: 'Έξοδο',
  lineitem: 'Χρεοπίστωση',
};

/**
 * Ποια μητρώα **χωράνε** στον πίνακα γραμμών του προορισμού. Είναι ακριβώς το `lineFits` του
 * `lib/ocr/purdoc-payload.ts`, διαβασμένο ανάποδα: εκεί κρίνεται μια ήδη γραμμένη αντιστοίχιση,
 * εδώ προσφέρονται οι επιλογές **πριν** γραφτεί — και οι δύο πρέπει να λένε το ίδιο, αλλιώς το UI
 * αφήνει τον χρήστη να διαλέξει κάτι που η καταχώριση θα απορρίψει.
 *
 *  • `LINLINES` → μόνο χρεοπίστωση (`MTRL` SODTYPE 53).
 *  • `EXPANAL`  → μόνο έξοδο (`EXPN`).
 *  • `ITELINES` / `SRVLINES` → είδος **ή** υπηρεσία: και οι δύο πίνακες δέχονται οποιοδήποτε
 *    `MTRL`, οπότε μια σειρά ρυθμισμένη σε `ITELINES` λέει «είδος ή υπηρεσία», όχι «είδος».
 *  • `AUTO` (PURDOC ανά γραμμή) → είδος, υπηρεσία ή έξοδο. **Όχι** χρεοπίστωση: το `autoTableFor`
 *    δεν έχει πίνακα να τη βάλει μέσα σε PURDOC.
 */
export const KINDS_FOR_LINE_TABLE: Record<PostLineTable, MatchKind[]> = {
  AUTO: ['product', 'service', 'expense'],
  ITELINES: ['product', 'service'],
  SRVLINES: ['product', 'service'],
  EXPANAL: ['expense'],
  LINLINES: ['lineitem'],
};

/** Κενή λίστα = **άγνωστο**: ο χρήστης βλέπει και τα τέσσερα, με ρητή προειδοποίηση. */
export function allowedLineKinds(target: PostingTarget | null | undefined): MatchKind[] {
  if (!target?.supported) return [];
  return KINDS_FOR_LINE_TABLE[target.lines] ?? [];
}

/** Χωράει αυτό το μητρώο στον προορισμό; Άγνωστος προορισμός ⇒ `true` (δεν κρίνουμε στα τυφλά). */
export function lineKindFits(target: PostingTarget | null | undefined, kind: MatchKind): boolean {
  const allowed = allowedLineKinds(target);
  return allowed.length === 0 || allowed.includes(kind);
}

/**
 * Το μητρώο που ανοίγει ο picker για μια ΑΤΑΙΡΙΑΣΤΗ γραμμή.
 *
 *  1. Αν ο προορισμός αφήνει **ένα** μητρώο, αυτό είναι — δεν υπάρχει τίποτα να αποφασιστεί.
 *  2. Αλλιώς, η ένδειξη του ίδιου του παραστατικού (`fallback`: η πιο συχνή ήδη αντιστοιχισμένη
 *     κατηγορία), αλλά **μόνο αν χωράει** στον προορισμό.
 *  3. Αλλιώς `null` — «διάλεξε μητρώο». Ποτέ σταθερό «Είδος»: αυτό ακριβώς έκανε η σελίδα να
 *     προτείνει «Είδος» σε παραστατικό που δέχεται μόνο χρεοπιστώσεις.
 */
export function defaultLineKind(
  target: PostingTarget | null | undefined,
  fallback: MatchKind | null | undefined,
): MatchKind | null {
  const allowed = allowedLineKinds(target);
  if (allowed.length === 1) return allowed[0];
  if (fallback && (allowed.length === 0 || allowed.includes(fallback))) return fallback;
  return null;
}

/** Η ελληνική εξήγηση «γιατί μόνο αυτά» — μπαίνει κάτω από το segmented control. */
export function lineKindsReason(target: PostingTarget | null | undefined): string {
  if (!target?.supported) {
    return 'Άγνωστος προορισμός καταχώρισης — δεν ξέρουμε σε ποιο μητρώο πρέπει να δείχνει η γραμμή.';
  }
  const allowed = allowedLineKinds(target);
  const names = allowed.map((k) => LINE_KIND_LABEL[k].toLowerCase());
  const list = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} ή ${names[names.length - 1]}`;
  // Το `AUTO` δεν είναι όνομα πίνακα που θα αναγνώριζε ο χρήστης — είναι «ανά γραμμή».
  return target.lines === 'AUTO'
    ? `Κάθε γραμμή πάει στον πίνακα που της αναλογεί — δέχεται ${list}.`
    : `Οι γραμμές πάνε σε «${target.lines}» — δέχεται ${list}.`;
}

/** Η πιο συχνή ήδη αντιστοιχισμένη κατηγορία του παραστατικού. `null` όταν δεν υπάρχει καμία. */
export function commonLineKind(kinds: readonly (MatchKind | null | undefined)[]): MatchKind | null {
  const tally = new Map<MatchKind, number>();
  for (const k of kinds) if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
  let best: MatchKind | null = null;
  let bestN = 0;
  for (const [k, n] of tally) if (n > bestN) { best = k; bestN = n; }
  return best;
}
