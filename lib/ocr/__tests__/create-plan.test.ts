import { describe, it, expect } from 'vitest';
import { createVerdict, splitCandidates, type CreateCandidate } from '../create-plan';

const c = (o: Partial<CreateCandidate> = {}): CreateCandidate => ({
  key: 'g1', kind: 'product', code: '600-747-110', sample: 'Soft1 OpEn myDATA Live', vatId: '1410', unitId: '101', ...o,
});

describe('createVerdict', () => {
  it('είδος με όλα τα στοιχεία ⇒ δημιουργείται, με τον κωδικό του ΠΡΟΜΗΘΕΥΤΗ', () => {
    const v = createVerdict(c());
    expect(v.ok && v.proposal).toMatchObject({ kind: 'product', code: '600-747-110', vatId: '1410', unitId: '101' });
  });

  it('υπηρεσία το ίδιο', () => {
    expect(createVerdict(c({ kind: 'service' })).ok).toBe(true);
  });

  it('ΕΞΟΔΟ και ΧΡΕΟΠΙΣΤΩΣΗ δεν δημιουργούνται μαζικά — θέλουν πρότυπο', () => {
    expect(createVerdict(c({ kind: 'expense' }))).toMatchObject({ ok: false, reason: 'θέλει πρότυπο' });
    expect(createVerdict(c({ kind: 'lineitem' }))).toMatchObject({ ok: false, reason: 'θέλει πρότυπο' });
  });

  it('χωρίς τύπο δεν δημιουργείται', () => {
    expect(createVerdict(c({ kind: null }))).toMatchObject({ ok: false, reason: 'χωρίς τύπο' });
  });

  it('η διπλοεγγραφή ΠΡΟΗΓΕΙΤΑΙ κάθε άλλου ελέγχου', () => {
    const v = createVerdict(c({ kind: null, duplicateOf: { mtrl: 3349, code: '600-747-110', name: 'Ήδη εκεί' } }));
    expect(v).toMatchObject({ ok: false, reason: 'υπάρχει ήδη' });
    expect(!v.ok && v.duplicate?.mtrl).toBe(3349);
  });

  it('χωρίς ΦΠΑ ή μονάδα δεν μαντεύουμε', () => {
    expect(createVerdict(c({ vatId: null }))).toMatchObject({ ok: false, reason: 'χωρίς ΦΠΑ' });
    expect(createVerdict(c({ unitId: null }))).toMatchObject({ ok: false, reason: 'χωρίς μονάδα' });
  });

  it('κενή περιγραφή δεν δημιουργεί ανώνυμη εγγραφή', () => {
    expect(createVerdict(c({ sample: '   ' }))).toMatchObject({ ok: false, reason: 'χωρίς περιγραφή' });
  });

  it('η περιγραφή κόβεται στο όριο του μητρώου', () => {
    const v = createVerdict(c({ sample: 'Α'.repeat(300) }));
    expect(v.ok && v.proposal.name.length).toBe(200);
  });

  it('κενός κωδικός γίνεται null — δεν στέλνουμε κενό string', () => {
    const v = createVerdict(c({ code: '  ' }));
    expect(v.ok && v.proposal.code).toBeNull();
  });
});

describe('splitCandidates', () => {
  it('χωρίζει έτοιμες από όσες θέλουν άνθρωπο, κρατώντας τον λόγο', () => {
    const { ready, blocked } = splitCandidates([
      c({ key: 'a' }),
      c({ key: 'b', kind: 'lineitem' }),
      c({ key: 'c', kind: null }),
    ]);
    expect(ready.map((r) => r.key)).toEqual(['a']);
    expect(blocked).toEqual([
      { key: 'b', sample: c().sample, reason: 'θέλει πρότυπο', duplicate: undefined },
      { key: 'c', sample: c().sample, reason: 'χωρίς τύπο', duplicate: undefined },
    ]);
  });
});
