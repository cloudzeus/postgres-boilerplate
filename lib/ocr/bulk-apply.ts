// lib/ocr/bulk-apply.ts — ΚΑΘΑΡΟ (χωρίς prisma / δίκτυο / server-only).
//
// «Δέξου όλες τις σίγουρες προτάσεις» — η απόφαση ΠΟΙΕΣ ομάδες επιτρέπεται να εφαρμοστούν χωρίς
// να τις κοιτάξει άνθρωπος.
//
// Γιατί υπάρχει: η ουρά «Είδη & έξοδα» ομαδοποιεί ήδη σωστά (48 ομάδες από δεκάδες παραστατικά)
// και το AI προτείνει ήδη — αλλά ο χρήστης εφάρμοζε **μία ομάδα τη φορά**. Σε πραγματικό φόρτο
// αυτό είναι δεκάδες κλικ πριν καταχωρηθεί το πρώτο παραστατικό, και είναι ο λόγος που η
// δουλειά δεν ολοκληρωνόταν ποτέ.
//
// Ο κανόνας είναι συντηρητικός ΕΠΙΤΗΔΕΣ. Μαζική εφαρμογή σημαίνει ότι κανείς δεν κοιτάζει την
// κάθε γραμμή· ό,τι περάσει από εδώ πρέπει να είναι τόσο βέβαιο όσο μια ανθρώπινη επιλογή.

import { AI_CONFIDENT_SCORE, type ScoredSuggestion } from './ai-apply';

export interface BulkCandidateGroup {
  key: string;
  /** Η κατηγορία μητρώου της ομάδας· `null` = δεν ξέρουμε καν τι είδους είναι. */
  category: string | null;
  suggestions: readonly (ScoredSuggestion & {
    mtrl: number | null; expn: number | null; lin: number | null; kind: string; code: string; name: string;
  })[];
}

export interface BulkPick {
  key: string;
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string;
  name: string;
  /** Γιατί επιλέχθηκε — φαίνεται στον χρήστη πριν πατήσει. */
  by: string;
  score: number;
}

/**
 * Η πρόταση που μπορεί να εφαρμοστεί μαζικά, ή `null`.
 *
 * Τρεις όροι, όλοι υποχρεωτικοί:
 *  1. Η ομάδα **ξέρει τι είδους** είναι (`category` όχι `null`). Χωρίς αυτό δεν έχουμε απόδειξη
 *     ότι η γραμμή είναι είδος, υπηρεσία, έξοδο ή χρεοπίστωση — δες `lib/ocr/line-kind.ts`.
 *  2. Η καλύτερη πρόταση πιάνει το ΙΔΙΟ κατώφλι με τον φθηνό δρόμο ({@link AI_CONFIDENT_SCORE}).
 *  3. Η πρόταση **δείχνει κάπου**: χωρίς `mtrl`/`expn`/`lin` δεν υπάρχει τι να γραφτεί.
 *
 * Ρητά ΕΞΩ: οι προτάσεις του μοντέλου (`by === 'ai'`). Το AI προτείνει, ο άνθρωπος δέχεται —
 * μαζική εφαρμογή ανθρώπινης-ποιότητας απόφασης από μοντέλο είναι ακριβώς ο τρόπος να γεμίσει
 * το μητρώο λάθη που κανείς δεν θα ξαναδεί.
 */
export function bulkPick(g: BulkCandidateGroup): BulkPick | null {
  if (!g.category) return null;
  let best: BulkCandidateGroup['suggestions'][number] | null = null;
  for (const s of g.suggestions) {
    if (s.by === 'ai') continue;
    if (s.mtrl == null && s.expn == null && s.lin == null) continue;
    if (s.score < AI_CONFIDENT_SCORE) continue;
    if (!best || s.score > best.score) best = s;
  }
  if (!best) return null;
  return {
    key: g.key, mtrl: best.mtrl, expn: best.expn, lin: best.lin,
    code: best.code, name: best.name, by: best.by, score: best.score,
  };
}

/** Όσες ομάδες μπορούν να εφαρμοστούν μαζικά, με τη σειρά που δόθηκαν. */
export function bulkPicks(groups: readonly BulkCandidateGroup[]): BulkPick[] {
  return groups.map(bulkPick).filter((p): p is BulkPick => p !== null);
}
