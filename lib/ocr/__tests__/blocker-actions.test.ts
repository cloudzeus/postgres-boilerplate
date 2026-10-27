// lib/ocr/__tests__/blocker-actions.test.ts
// Κάθε εμπόδιο πρέπει να ΞΕΡΕΙ τι το λύνει — αλλιώς η σελίδα εκκρεμοτήτων ξαναγίνεται λίστα.
import { describe, it, expect } from 'vitest';
import { BLOCKER_ACTIONS, BLOCKER_ORDER, blockerAction, sortBlockers, tallyBlockers } from '../blocker-actions';
import type { BlockerCode } from '../purdoc-payload';

/** Όλοι οι κωδικοί του τύπου, γραμμένοι ρητά: αν προστεθεί νέος, το τεστ πέφτει. */
const ALL: BlockerCode[] = [
  'not_completed', 'no_category', 'line_discount_ambiguous', 'no_trader', 'no_series',
  'no_date', 'no_number', 'no_lines', 'unmatched_lines', 'no_vat_category', 'totals_mismatch',
  'lines_need_mtrl', 'lines_need_expn', 'lines_need_lineitem', 'lines_lineitem_unsupported',
  'lines_no_mtrtype', 'series_unknown', 'series_module_unsupported', 'trader_kind_mismatch',
  'account_missing', 'account_not_in_chart', 'account_is_mask', 'account_not_postable',
];

describe('κάλυψη', () => {
  it('ΚΑΘΕ κωδικός έχει ενέργεια', () => {
    const missing = ALL.filter((c) => !BLOCKER_ACTIONS[c]);
    expect(missing).toEqual([]);
  });

  it('ΚΑΘΕ κωδικός έχει θέση στη σειρά εμφάνισης', () => {
    expect(ALL.filter((c) => !BLOCKER_ORDER.includes(c))).toEqual([]);
  });

  it('καμία ετικέτα δεν είναι ο ίδιος ο κωδικός — ο χρήστης δεν διαβάζει snake_case', () => {
    for (const c of ALL) expect(BLOCKER_ACTIONS[c]!.short).not.toBe(c);
  });

  it('άγνωστος κωδικός δεν σκάει: γυρίζει ασφαλές fallback', () => {
    const a = blockerAction('κάτι_νέο' as BlockerCode);
    expect(a.short).toBe('κάτι_νέο');
    expect(a.anchor).toBe('#');
  });
});

describe('sortBlockers', () => {
  it('η ταυτότητα του παραστατικού προηγείται της λεπτομέρειας γραμμής', () => {
    expect(sortBlockers(['no_vat_category', 'no_trader', 'unmatched_lines']))
      .toEqual(['no_trader', 'unmatched_lines', 'no_vat_category']);
  });

  it('άγνωστοι κωδικοί πάνε στο τέλος, σταθερά', () => {
    expect(sortBlockers(['ζ' as BlockerCode, 'no_trader', 'α' as BlockerCode]))
      .toEqual(['no_trader', 'α', 'ζ']);
  });
});

describe('tallyBlockers', () => {
  it('μετράει ΠΑΡΑΣΤΑΤΙΚΑ, όχι εμφανίσεις: διπλό στο ίδιο έγγραφο μετράει μία', () => {
    expect(tallyBlockers([['no_trader', 'no_trader'], ['no_trader'], ['no_category']]))
      .toEqual([{ code: 'no_trader', docs: 2 }, { code: 'no_category', docs: 1 }]);
  });

  it('κενό μέσα, κενό έξω', () => {
    expect(tallyBlockers([])).toEqual([]);
    expect(tallyBlockers([[], []])).toEqual([]);
  });
});
