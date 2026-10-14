import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    softoneExpense: { findMany: vi.fn() },
    softoneAccount: { findMany: vi.fn() },
    softoneProject: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => ({ requireAnyPermission: vi.fn().mockResolvedValue({ id: 'u' }) }));
vi.mock('@/lib/softone', () => ({ ISSUER_SODTYPES: [12, 16, 15], SXACCOUNT_MTRTYPE: { expense: 2 } }));
vi.mock('@/lib/ocr/mydata-labels', () => ({ classificationLabeller: async () => () => ({ label: null, missing: true }) }));
vi.mock('@/lib/softone-sync/lineitem-activate', () => ({ findInactiveLineItems: vi.fn().mockResolvedValue([]) }));

import { GET } from '@/app/api/admin/softone/search/route';

const call = async (qs: string) => (await (await GET(new Request(`http://x/api/admin/softone/search?${qs}`))).json()) as { results: { code: string }[] };

beforeEach(() => vi.clearAllMocks());

// Παλινδρόμηση: η αφαίρεση του φίλτρου της βάσης (για ανοχή σε τόνους) ξέχασε το φίλτρο στη μνήμη
// σε έξοδα, λογαριασμούς και έργα — κάθε αναζήτηση έδειχνε τα ίδια πρώτα 25, ό,τι κι αν έγραφες.
describe('GET /api/admin/softone/search — το κείμενο φιλτράρει', () => {
  it('έξοδα: «καυσιμα» βρίσκει «Καύσιμα» και μόνο αυτό', async () => {
    db.softoneExpense.findMany.mockResolvedValue([
      { expn: 1, code: '115', name: 'Έξοδο τόκων', vat: null, classTypeX: null, classCategoryX: null },
      { expn: 2, code: '983', name: 'Καύσιμα', vat: '1410', classTypeX: null, classCategoryX: null },
    ]);
    expect((await call('type=expenses&q=καυσιμα')).results.map((r) => r.code)).toEqual(['983']);
  });

  it('λογαριασμοί: ο πλήρης κωδικός βρίσκεται και πέρα από τους 25 πρώτους', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ acnt: i, code: `10.00.00.${String(i).padStart(4, '0')}`, name: 'Κτίρια', grade: 4 }));
    db.softoneAccount.findMany.mockResolvedValue([...many, { acnt: 99, code: '64.00.00.0224', name: 'Έξοδα κινήσεως ΦΙΧ 24%', grade: 4 }]);
    expect((await call('type=accounts&q=64.00.00.0224')).results.map((r) => r.code)).toEqual(['64.00.00.0224']);
    expect(db.softoneAccount.findMany.mock.calls[0][0].take).toBeUndefined();
  });

  it('έργα: φιλτράρει με το κείμενο', async () => {
    db.softoneProject.findMany.mockResolvedValue([
      { prjc: 1, code: '112', name: 'Αναβάθμιση Συναγερμού', trdr: null },
      { prjc: 2, code: '501', name: 'ΕΡΓΟ', trdr: null },
    ]);
    expect((await call('type=projects&q=συναγερμ')).results.map((r) => r.code)).toEqual(['112']);
  });
});
