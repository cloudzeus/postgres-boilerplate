import { describe, it, expect } from 'vitest';
import { bulkPick, bulkPicks } from '../bulk-apply';

const sug = (o: Partial<Parameters<typeof bulkPick>[0]['suggestions'][number]> = {}) => ({
  mtrl: 100, expn: null, lin: null, kind: 'product', code: 'Κ1', name: 'Είδος', score: 0.95, by: 'code', ...o,
});
const grp = (o: Partial<Parameters<typeof bulkPick>[0]> = {}) => ({
  key: 'g1', category: 'product', suggestions: [sug()], ...o,
});

describe('bulkPick', () => {
  it('σίγουρη ντετερμινιστική πρόταση με κατηγορία ⇒ εφαρμόζεται', () => {
    expect(bulkPick(grp())).toMatchObject({ key: 'g1', mtrl: 100, by: 'code' });
  });

  it('ΧΩΡΙΣ κατηγορία δεν εφαρμόζεται ποτέ — δεν ξέρουμε καν τι είδους είναι η γραμμή', () => {
    expect(bulkPick(grp({ category: null }))).toBeNull();
  });

  it('πρόταση ΜΟΝΤΕΛΟΥ δεν εφαρμόζεται μαζικά, όσο σίγουρη κι αν λέει ότι είναι', () => {
    expect(bulkPick(grp({ suggestions: [sug({ by: 'ai', score: 1 })] }))).toBeNull();
  });

  it('κάτω από το κατώφλι δεν εφαρμόζεται', () => {
    expect(bulkPick(grp({ suggestions: [sug({ score: 0.79 })] }))).toBeNull();
    expect(bulkPick(grp({ suggestions: [sug({ score: 0.8 })] }))).not.toBeNull();
  });

  it('πρόταση που δεν δείχνει πουθενά δεν εφαρμόζεται', () => {
    expect(bulkPick(grp({ suggestions: [sug({ mtrl: null, expn: null, lin: null })] }))).toBeNull();
  });

  it('διαλέγει την ΚΑΛΥΤΕΡΗ ντετερμινιστική, αγνοώντας υψηλότερη του μοντέλου', () => {
    const p = bulkPick(grp({ suggestions: [
      sug({ by: 'ai', score: 0.99, mtrl: 999 }),
      sug({ by: 'name', score: 0.85, mtrl: 200 }),
      sug({ by: 'code2', score: 0.92, mtrl: 300 }),
    ] }));
    expect(p).toMatchObject({ mtrl: 300, by: 'code2' });
  });

  it('έξοδο και χρεοπίστωση περνούν το ίδιο', () => {
    expect(bulkPick(grp({ category: 'expense', suggestions: [sug({ mtrl: null, expn: 7 })] }))).toMatchObject({ expn: 7 });
    expect(bulkPick(grp({ category: 'lineitem', suggestions: [sug({ mtrl: null, lin: 9 })] }))).toMatchObject({ lin: 9 });
  });
});

describe('bulkPicks', () => {
  it('κρατά μόνο τις εφαρμόσιμες, με τη σειρά', () => {
    const out = bulkPicks([grp({ key: 'a' }), grp({ key: 'b', category: null }), grp({ key: 'c' })]);
    expect(out.map((p) => p.key)).toEqual(['a', 'c']);
  });
  it('κενό μέσα, κενό έξω', () => expect(bulkPicks([])).toEqual([]));
});
