// lib/ocr/mydata-labels.ts — SERVER. «Πώς θα χαρακτηριστεί αυτή η γραμμή στο myDATA;»
//
// Ο χαρακτηρισμός είναι ΙΔΙΟΤΗΤΑ ΤΟΥ ΜΗΤΡΩΟΥ στο SoftOne (είδος / υπηρεσία / χρεοπίστωση /
// έξοδο), όχι κάτι που ορίζει η εφαρμογή ανά γραμμή παραστατικού. Εδώ απλώς ΜΕΤΑΦΡΑΖΟΥΜΕ τους
// κωδικούς που κουβαλά το μητρώο σε ελληνικά, ώστε ο χρήστης να δει τι θα σταλεί. Διόρθωση
// λάθους χαρακτηρισμού σημαίνει διόρθωση του μητρώου στο ERP — η εφαρμογή δεν το γράφει ποτέ.
//
// ⚠ ΔΥΟ ΔΙΑΦΟΡΕΤΙΚΟΙ ΑΞΟΝΕΣ, ΠΟΥ ΔΕΝ ΣΥΝΔΕΟΝΤΑΙ ΠΟΤΕ:
//
//  1. `classType` / `classCategory` (πεδία CLASSTYPE / CLASSCATEGORY, editors MYDATACLTYPE /
//     MYDATACLCATEGORY) → ο ΧΑΡΑΚΤΗΡΙΣΜΟΣ. Κλειδιά των EditLists· τα κοιτάμε στα
//     `SoftoneMyDataClassType.code` / `SoftoneMyDataClassCategory.code`. ΣΩΣΤΟ join.
//  2. `myDataCode` (πεδίο MYDATACODE, editor `$s1ClassType`) → η ΚΑΤΗΓΟΡΙΑ myDATA. Είναι ένας
//     μικρός αριθμός-enum: επαληθευμένο live στον dev tenant, το `MTRL.MYDATACODE` γυρίζει «1»
//     ή «7». ΔΕΝ είναι το `MYDATACLTYPE.MYDATACODE` (που είναι αλφαριθμητικό τύπου
//     «category2_1»). Ένα join ανάμεσά τους δεν θα ταίριαζε ΠΟΤΕ, σιωπηλά — γι' αυτό δεν
//     υπάρχει και δεν πρέπει να προστεθεί.
import 'server-only';
import { prisma } from '@/lib/db';

export interface ClassificationRef {
  classType?: number | null;
  classCategory?: number | null;
  myDataCode?: string | null;
}

export interface Classification {
  /** «Τύπος · Κατηγορία», ή «Κατηγορία myDATA N», ή null όταν το μητρώο δεν κουβαλά τίποτα. */
  label: string | null;
  /** `true` όταν το μητρώο θα καταχωρίσει ΑΧΑΡΑΚΤΗΡΙΣΤΗ γραμμή. */
  missing: boolean;
}

export const EMPTY_CLASSIFICATION: Classification = { label: null, missing: true };

/**
 * Φορτώνει μία φορά τις δύο λίστες (MYDATACLTYPE / MYDATACLCATEGORY) και επιστρέφει έναν
 * μεταφραστή. Οι λίστες είναι μικρές· τις διαβάζουμε ολόκληρες αντί για ερώτημα ανά γραμμή.
 */
export async function classificationLabeller(): Promise<(ref: ClassificationRef) => Classification> {
  const [types, categories] = await Promise.all([
    prisma.softoneMyDataClassType.findMany({ select: { code: true, name: true, myDataCode: true } }),
    prisma.softoneMyDataClassCategory.findMany({ select: { code: true, name: true, myDataCode: true } }),
  ]);
  // Ο ίδιος κωδικός μπορεί να υπάρχει σε δύο SOTYPE (εσόδων/εξόδων) με το ίδιο νόημα· κρατάμε
  // τον πρώτο και δεν προσποιούμαστε ότι ξέρουμε την πλευρά από τον κωδικό μόνο.
  const typeById = new Map<number, string>();
  for (const t of types) if (!typeById.has(t.code)) typeById.set(t.code, t.name || t.myDataCode || String(t.code));
  const catById = new Map<number, string>();
  for (const c of categories) if (!catById.has(c.code)) catById.set(c.code, c.name || c.myDataCode || String(c.code));

  return (ref) => {
    const parts: string[] = [];
    if (ref.classType != null) parts.push(typeById.get(ref.classType) ?? `Τύπος ${ref.classType}`);
    if (ref.classCategory != null) parts.push(catById.get(ref.classCategory) ?? `Κατηγορία ${ref.classCategory}`);
    // ΟΧΙ αναζήτηση στις λίστες χαρακτηρισμού: άλλος άξονας (βλ. σημείωση στην κορυφή). Το
    // δείχνουμε ως αυτό που είναι — κωδικό κατηγορίας myDATA — αντί να μοιάζει με περιγραφή.
    const code = String(ref.myDataCode ?? '').trim();
    if (code) parts.push(`Κατηγορία myDATA ${code}`);
    return parts.length ? { label: parts.join(' · '), missing: false } : EMPTY_CLASSIFICATION;
  };
}

// Οι δύο λίστες αλλάζουν μόνο με συγχρονισμό. Ένας μικρός κύκλος μνήμης γλιτώνει δύο ερωτήματα
// ανά ομάδα στην ουρά, όπου ο μεταφραστής καλείται δεκάδες φορές στο ίδιο render.
const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; fn: (ref: ClassificationRef) => Classification } | null = null;

/** Ο ίδιος μεταφραστής, με μικρό cache — για βρόχους (ουρά, λίστες αποτελεσμάτων). */
export async function cachedClassificationLabeller(): Promise<(ref: ClassificationRef) => Classification> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.fn;
  const fn = await classificationLabeller();
  cached = { at: Date.now(), fn };
  return fn;
}

/** Μόνο για tests / μετά από συγχρονισμό. */
export const clearClassificationCache = (): void => { cached = null; };
