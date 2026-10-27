import { describe, it, expect } from 'vitest';
import { analyticsParts, analyticsLabel } from '../analytics-label';

describe('analyticsParts', () => {
  it('χωρίζει κωδικό και τίτλο', () => {
    expect(analyticsParts('ΕΡΓ001 — Ανακαίνιση γραφείων')).toEqual({ code: 'ΕΡΓ001', title: 'Ανακαίνιση γραφείων' });
  });

  it('ο τίτλος μπορεί να έχει ΚΑΙ αυτός παύλα — σπάμε στον ΠΡΩΤΟ διαχωριστή', () => {
    expect(analyticsParts('ΕΡΓ002 — Ανακαίνιση — Β΄ φάση'))
      .toEqual({ code: 'ΕΡΓ002', title: 'Ανακαίνιση — Β΄ φάση' });
  });

  it('χωρίς διαχωριστή: όλο τίτλος, ποτέ κενό', () => {
    expect(analyticsParts('Ανακαίνιση')).toEqual({ code: null, title: 'Ανακαίνιση' });
    expect(analyticsParts('1234')).toEqual({ code: null, title: '1234' });
  });

  it('κενό ή άγνωστο δεν σκάει', () => {
    expect(analyticsParts(null)).toEqual({ code: null, title: '' });
    expect(analyticsParts(undefined)).toEqual({ code: null, title: '' });
    expect(analyticsParts('   ')).toEqual({ code: null, title: '' });
  });

  it('διαχωριστής χωρίς τίτλο: ό,τι υπάρχει γίνεται τίτλος αντί να μείνει κενό', () => {
    expect(analyticsParts('ΕΡΓ003 — ')).toEqual({ code: null, title: 'ΕΡΓ003' });
  });

  it('διαχωριστής στην αρχή δεν παράγει κενό κωδικό', () => {
    expect(analyticsParts(' — Ανακαίνιση').title).toBe('— Ανακαίνιση');
  });

  it('είναι αντίστροφο του analyticsLabel', () => {
    expect(analyticsParts(analyticsLabel('ΚΚ10', 'Διοίκηση'))).toEqual({ code: 'ΚΚ10', title: 'Διοίκηση' });
  });
});
