import { describe, it, expect, vi } from 'vitest';

vi.mock('../extract', () => ({ callPdfNative: vi.fn(), parseJsonLoose: (s: string) => JSON.parse(s), resolveCfg: vi.fn() }));

import { mergeSignals, suggestSplitsFromSignals, textSignalOf, type PageSignal } from '../split';
import { parseVisionPages } from '../split-vision';

// Έγκυροι ΑΦΜ (mod-11) για συνθετικούς εκδότες.
const A = '094019245';
const B = '094014201';

describe('suggestSplitsFromSignals', () => {
  it('στοίβα σαρωτή: μονοσέλιδα, «1/4–2/4», μονές σελίδες «1/5,3/5,5/5», ίδιος αριθμός χωρίς ένδειξη', () => {
    const pages: PageSignal[] = [
      { startsNew: true, issuerAfm: A, docNumber: '100' },                         // 0  νέο
      { startsNew: true, issuerAfm: B, docNumber: '200' },                         // 1  νέο
      { startsNew: true, issuerAfm: A, docNumber: 'X-1', pageOf: { page: 1, of: 4 } }, // 2  νέο
      { startsNew: false, issuerAfm: A, docNumber: 'X-1', pageOf: { page: 2, of: 4 } }, // 3  συνέχεια
      { startsNew: true, issuerAfm: B, docNumber: '7', pageOf: { page: 1, of: 5 } },  // 4  νέο
      { startsNew: false, pageOf: { page: 3, of: 5 } },                             // 5  συνέχεια (μονές σελίδες)
      { startsNew: true, issuerAfm: B, docNumber: '7', pageOf: { page: 5, of: 5 } },  // 6  συνέχεια: «σελ. 5/5» νικά τη γνώμη
      { startsNew: true, issuerAfm: A, docNumber: '300' },                         // 7  νέο
      { startsNew: true, issuerAfm: A, docNumber: '300' },                         // 8  συνέχεια: ίδιος αριθμός, ίδιος εκδότης
      { blank: true, startsNew: true },                                            // 9  κενή → με το προηγούμενο
      { startsNew: true },                                                         // 10 νέο (μόνο γνώμη)
      { startsNew: false },                                                        // 11 συνέχεια
    ];
    expect(suggestSplitsFromSignals(pages)).toEqual([0, 1, 2, 4, 7, 10]);
  });

  it('διαφορετικός ΑΦΜ σπάει ακόμη κι όταν το μοντέλο λέει «συνέχεια»· χωρίς κανένα σήμα → ένα παραστατικό', () => {
    expect(suggestSplitsFromSignals([{ issuerAfm: A }, { issuerAfm: B, startsNew: false }])).toEqual([0, 1]);
    expect(suggestSplitsFromSignals([{}, {}, {}])).toEqual([0]);
    expect(suggestSplitsFromSignals([])).toEqual([]);
  });

  it('ο αριθμός συγκρίνεται κανονικοποιημένος («ΤΠΥ-17» = «ΤΠΥ 17»)', () => {
    expect(suggestSplitsFromSignals([{ docNumber: 'ΤΠΥ-17' }, { docNumber: 'ΤΠΥ 17', startsNew: true }])).toEqual([0]);
  });
});

describe('mergeSignals', () => {
  it('το κείμενο υπερισχύει, η ανάλυση συμπληρώνει', () => {
    const text = textSignalOf(`ΤΙΜΟΛΟΓΙΟ ΑΡ. 555 ΑΦΜ ${A} ΣΕΛ. 1/2`);
    expect(text).toMatchObject({ docNumber: '555', issuerAfm: A, pageOf: { page: 1, of: 2 } });
    const m = mergeSignals(text, { docNumber: '999', issuerAfm: B, startsNew: false, blank: false });
    expect(m).toMatchObject({ docNumber: '555', issuerAfm: A, pageOf: { page: 1, of: 2 }, startsNew: false });
    expect(mergeSignals(textSignalOf(''), { docNumber: '999' }).docNumber).toBe('999');
  });
});

describe('parseVisionPages', () => {
  it('ευθυγραμμίζει με τις σελίδες, πετά άκυρους ΑΦΜ και «k/null»', () => {
    const r = parseVisionPages({
      pages: [
        { page: 1, startsNew: true, kind: 'invoice', issuerName: 'Εκδότης Α', issuerAfm: `EL${A}`, docNumber: '100', pageOf: '1/null', total: 124 },
        { page: 3, startsNew: false, kind: 'blank', issuerAfm: '123456789', docNumber: null, pageOf: '2/2', total: null },
      ],
    }, 3);
    expect(r.signals[0]).toMatchObject({ startsNew: true, issuerAfm: A, docNumber: '100', pageOf: null, blank: false });
    expect(r.signals[1]).toEqual({});                       // η σελίδα 2 έλειπε από την απάντηση
    expect(r.signals[2]).toMatchObject({ issuerAfm: null, blank: true, pageOf: { page: 2, of: 2 } });
    expect(r.info[0]).toMatchObject({ issuerName: 'Εκδότης Α', total: 124 });
  });

  it('δέχεται και σκέτο πίνακα', () => {
    expect(parseVisionPages([{ startsNew: true, docNumber: '1' }], 1).signals[0].docNumber).toBe('1');
  });
});
