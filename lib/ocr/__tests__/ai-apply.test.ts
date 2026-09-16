// lib/ocr/__tests__/ai-apply.test.ts
// Ο κανόνας που κλειδώνει αυτό το αρχείο είναι ΕΝΑΣ και δεν διαπραγματεύεται:
// **αυτόματη πηγή δεν ξαναγράφει ποτέ ανθρώπινη επιλογή** — ούτε ντετερμινιστική απόδειξη.
//
// Είναι το ίδιο σφάλμα με το «μια Αλλαγή είδους ξε-μάθαινε την αναλυτική»: εκεί μια αυτόματη
// γραφή έσβηνε ό,τι είχε διαλέξει ο χρήστης· εδώ μια απάντηση μοντέλου με βεβαιότητα 0,6
// αντικαθιστούσε κατηγορία που είχε πατήσει ο χρήστης ή είχε ορίσει η δομή του ERP.
import { describe, it, expect } from 'vitest';
import {
  AI_CONFIDENT_SCORE, applyAiCategories, bestSuggestionScore, needsAi,
} from '../ai-apply';
import type { MatchKind } from '../line-match';

const sug = (score: number, by = 'name') => ({ score, by });

describe('needsAi — δεν πληρώνουμε για ερωτήσεις ήδη απαντημένες', () => {
  it('ομάδα με κατηγορία ΚΑΙ σίγουρη πρόταση δεν ρωτιέται', () => {
    expect(needsAi({ category: 'lineitem', suggestions: [sug(AI_CONFIDENT_SCORE)] })).toBe(false);
    // Η μνήμη μετράει ως πλήρης βεβαιότητα, όποιο σκορ κι αν κουβαλά.
    expect(needsAi({ category: 'expense', suggestions: [sug(0.1, 'memory')] })).toBe(false);
  });

  it('«χωρίς κατηγορία» ρωτιέται πάντα — ακόμη κι όταν ο κωδικός είναι σίγουρος', () => {
    expect(needsAi({ category: null, suggestions: [sug(1, 'code')] })).toBe(true);
  });

  it('κατηγορία χωρίς σίγουρη πρόταση ρωτιέται — ο κωδικός λείπει ακόμη', () => {
    expect(needsAi({ category: 'product', suggestions: [] })).toBe(true);
    expect(needsAi({ category: 'product', suggestions: [sug(0.79)] })).toBe(true);
  });

  it('bestSuggestionScore: κενή λίστα = 0, μνήμη = 1', () => {
    expect(bestSuggestionScore([])).toBe(0);
    expect(bestSuggestionScore([sug(0.3), sug(0.62)])).toBe(0.62);
    expect(bestSuggestionScore([sug(0, 'memory')])).toBe(1);
  });
});

describe('applyAiCategories — η επιλογή του ανθρώπου δεν πατιέται', () => {
  const none = new Map<string, MatchKind | null>();

  it('γράφει τύπο ΜΟΝΟ σε ομάδα πραγματικά χωρίς κατηγορία', () => {
    const next = applyAiCategories({}, [{ key: 'g1', kind: 'expense' }], new Map([['g1', null]]));
    expect(next).toEqual({ g1: 'expense' });
  });

  it('ΔΕΝ αντικαθιστά την κατηγορία που διάλεξε ο χρήστης', () => {
    const next = applyAiCategories(
      { g1: 'service' },
      [{ key: 'g1', kind: 'product' }],
      none,
    );
    expect(next).toEqual({ g1: 'service' });
  });

  it('ΔΕΝ αντικαθιστά ντετερμινιστική κατηγορία (π.χ. LINLINES ⇒ χρεοπίστωση)', () => {
    const next = applyAiCategories(
      {},
      [{ key: 'g1', kind: 'product' }],
      new Map<string, MatchKind | null>([['g1', 'lineitem']]),
    );
    expect(next).toEqual({});
  });

  it('απάντηση χωρίς τύπο (σκέτη παρατήρηση, π.χ. ΠΑΓΙΟ) δεν επιλέγει τίποτα', () => {
    expect(applyAiCategories({}, [{ key: 'g1', kind: null }], none)).toEqual({});
  });

  it('δεν μεταλλάσσει το state που της δόθηκε', () => {
    const prev = { g1: 'service' as MatchKind };
    const next = applyAiCategories(prev, [{ key: 'g2', kind: 'expense' }], none);
    expect(prev).toEqual({ g1: 'service' });
    expect(next).toEqual({ g1: 'service', g2: 'expense' });
  });
});
