// lib/ocr/ai-apply.ts — ΚΑΘΑΡΟ (χωρίς React / prisma / δίκτυο).
//
// Δύο ερωτήματα της ουράς «Είδη & έξοδα», απαντημένα σε ένα σημείο ώστε να είναι δοκιμάσιμα:
//
//  1. **Ποιες ομάδες αξίζει να ρωτηθούν;** — όχι όσες φαίνονται, αλλά όσες είναι όντως άλυτες.
//  2. **Ποιες απαντήσεις επιτρέπεται να γράψουν κατηγορία;** — καμία πάνω σε επιλογή που
//     υπάρχει ήδη.
//
// Ο κανόνας είναι ο ίδιος που έχει ήδη η αναλυτική (`source === 'manual'` δεν πατιέται) και ο
// ίδιος που μας δίδαξε το σφάλμα «μια Αλλαγή είδους ξε-μάθαινε την αναλυτική»:
// **ΑΥΤΟΜΑΤΗ ΠΗΓΗ ΔΕΝ ΞΑΝΑΓΡΑΦΕΙ ΠΟΤΕ ΑΝΘΡΩΠΙΝΗ ΕΠΙΛΟΓΗ** — ούτε ντετερμινιστική απόδειξη.

import type { MatchKind } from '@/lib/ocr/line-match';

/**
 * Πάνω από αυτό το σκορ ο φθηνός δρόμος (μνήμη / ομοιότητα κωδικού-ονόματος) θεωρείται αρκετός.
 * ΙΔΙΟ κατώφλι με τον server (`CONFIDENT_SCORE` στο `lib/ocr/expense-ai.ts`, που το εισάγει από
 * εδώ): αν διαφωνούσαν, το UI θα πλήρωνε ερωτήσεις που ο server παραλείπει ούτως ή άλλως.
 */
export const AI_CONFIDENT_SCORE = 0.8;

/** Ό,τι χρειάζεται ο κανόνας από μια πρόταση — σκορ και προέλευση, τίποτε άλλο. */
export interface ScoredSuggestion {
  score: number;
  /** code2 | code1 | code | name | memory | ai */
  by: string;
}

/** Η καλύτερη ντετερμινιστική πρόταση μιας ομάδας· η **μνήμη** μετράει ως πλήρης βεβαιότητα. */
export function bestSuggestionScore(suggestions: readonly ScoredSuggestion[]): number {
  return suggestions.reduce((max, s) => Math.max(max, s.by === 'memory' ? 1 : s.score), 0);
}

/** Η κατάσταση μιας ομάδας, όπως τη βλέπει η ουρά τη στιγμή του κλικ. */
export interface AiAskCandidate {
  /** Η κατηγορία που ισχύει τώρα: η επιλογή του χρήστη, αλλιώς η ντετερμινιστική του server. */
  category: MatchKind | null;
  suggestions: readonly ScoredSuggestion[];
}

/**
 * Αξίζει να ρωτηθεί το μοντέλο για αυτή την ομάδα;
 *
 * **ΟΧΙ** όταν η ομάδα έχει ήδη **και** κατηγορία **και** σίγουρη πρόταση κωδικού: εκεί δεν
 * υπάρχει ερώτημα, υπάρχει μόνο κόστος — και ο κίνδυνος μια απάντηση με βεβαιότητα 0,6 να
 * αντικαταστήσει ένα `lineitem` που ήρθε από τη δομή του ERP (`LINLINES`) ή από τη μνήμη.
 */
export function needsAi(g: AiAskCandidate): boolean {
  return g.category == null || bestSuggestionScore(g.suggestions) < AI_CONFIDENT_SCORE;
}

/** Το ελάχιστο που χρειάζεται ο κανόνας από μια απάντηση του μοντέλου. */
export interface AiCategoryAnswer {
  key: string;
  kind: MatchKind | null;
}

/**
 * Εφαρμόζει τους ΤΥΠΟΥΣ που πρότεινε το μοντέλο πάνω στις επιλογές της ουράς, χωρίς ποτέ να
 * πατήσει υπάρχουσα απόφαση:
 *
 *  • `chosen[key]` (ο χρήστης πάτησε το segmented, ή προηγούμενη πρόταση που δέχτηκε) ⇒ μένει·
 *  • `deterministic[key]` (μνήμη, ήδη ταιριασμένη υπηρεσία, προορισμός σειράς) ⇒ μένει·
 *  • μόνο μια ομάδα που είναι **πραγματικά** «χωρίς κατηγορία» δέχεται τον τύπο του μοντέλου.
 *
 * Επιστρέφει ΝΕΟ αντικείμενο (το state της React δεν μεταλλάσσεται ποτέ επί τόπου).
 */
export function applyAiCategories(
  chosen: Readonly<Record<string, MatchKind>>,
  answers: readonly AiCategoryAnswer[],
  deterministic: ReadonlyMap<string, MatchKind | null>,
): Record<string, MatchKind> {
  const next: Record<string, MatchKind> = { ...chosen };
  for (const a of answers) {
    if (!a.kind) continue;
    if (next[a.key] != null) continue;
    if (deterministic.get(a.key) != null) continue;
    next[a.key] = a.kind;
  }
  return next;
}
