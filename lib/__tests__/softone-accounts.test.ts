// lib/__tests__/softone-accounts.test.ts
// Η ανάγνωση του GetTable ACNT. Ζωντανά το GetTable ΠΡΟΣΘΕΤΕΙ στήλες που δεν ζητήθηκαν (AFM, CODE1)
// και ΑΛΛΑΖΕΙ τη σειρά: ο αναγνώστης πρέπει να διαβάζει ΚΑΤΑ ΟΝΟΜΑ από το `model`. Αυτό το test
// υπάρχει για να μην «απλοποιηθεί» ποτέ σε ανάγνωση κατά θέση.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/settings', () => ({ getSetting: async () => undefined, setSetting: async () => {} }));

import { parseAccountsResponse } from '@/lib/softone';

const model = (names: string[]) => [names.map((name) => ({ name }))];

describe('parseAccountsResponse', () => {
  it('διαβάζει κατά ΟΝΟΜΑ, με στήλες ανακατεμένες και επιπλέον', () => {
    // Σειρά ΔΙΑΦΟΡΕΤΙΚΗ από το ζητούμενο (ACNT, CODE, NAME, ACNGRADE, SODTYPE, ISACTIVE, ACNMOVING)
    // και με δύο στήλες που δεν ζητήσαμε ανάμεσα.
    const res = {
      success: true, count: 2,
      model: model(['CODE', 'AFM', 'ACNMOVING', 'NAME', 'ACNT', 'CODE1', 'ISACTIVE', 'SODTYPE', 'ACNGRADE']),
      data: [
        ['61.02.00.0024', '', '1', 'Προμήθειες για αγορές με Φ.Π.Α. 24%', '2801', 'X', '1', '89', '4'],
        ['60.00', '099999999', '0', 'Αμοιβές έμμισθου προσωπικού', '1500', '', '0', '89', '2'],
      ],
    };
    expect(parseAccountsResponse(res)).toEqual([
      { acnt: 2801, code: '61.02.00.0024', name: 'Προμήθειες για αγορές με Φ.Π.Α. 24%', grade: 4, sodtype: 89, isActive: true, postable: true },
      { acnt: 1500, code: '60.00', name: 'Αμοιβές έμμισθου προσωπικού', grade: 2, sodtype: 89, isActive: false, postable: false },
    ]);
  });

  it('χωρίς στήλη ACNMOVING (ή κενή) ⇒ postable null, ΠΟΤΕ true', () => {
    const rows = parseAccountsResponse({
      success: true, count: 2, model: model(['ACNT', 'CODE', 'NAME', 'ACNMOVING']),
      data: [['1', '62', 'ΠΑΡΟΧΕΣ', ''], ['2', '63', 'ΦΟΡΟΙ', null as unknown as string]],
    });
    expect(rows.map((r) => r.postable)).toEqual([null, null]);
    const noCol = parseAccountsResponse({ success: true, count: 1, model: model(['ACNT', 'CODE', 'NAME']), data: [['1', '62', 'Χ']] });
    expect(noCol[0].postable).toBeNull();
  });

  it('λείπει ΚΩΔΙΚΟΣ ή ΠΕΡΙΓΡΑΦΗ από την απάντηση ⇒ σφάλμα, όχι μετατοπισμένα δεδομένα', () => {
    expect(() => parseAccountsResponse({ success: true, count: 0, model: model(['ACNT', 'NAME']), data: [] }))
      .toThrow(/λείπει η στήλη CODE/);
  });

  it('κοντή απάντηση (count ≠ γραμμές) ⇒ σφάλμα', () => {
    expect(() => parseAccountsResponse({
      success: true, count: 5203, model: model(['ACNT', 'CODE', 'NAME']), data: [['1', '62', 'Χ']],
    })).toThrow(/δηλώνει 5203 λογαριασμούς αλλά επέστρεψε 1/);
  });

  it('success:false ⇒ σφάλμα', () => {
    expect(() => parseAccountsResponse({ success: false, error: 'Ole exception' })).toThrow(/Ole exception/);
  });
});
