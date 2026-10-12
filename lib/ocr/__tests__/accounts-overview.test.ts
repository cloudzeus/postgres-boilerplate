import { describe, expect, it, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    ocrInvoiceItem: { findMany: vi.fn() },
    ocrDocument: { findMany: vi.fn() },
    softoneLineItem: { findMany: vi.fn() },
    softoneAccount: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
const { inactive } = vi.hoisted(() => ({ inactive: { cachedInactiveLineItems: vi.fn() } }));
vi.mock('@/lib/softone-sync/lineitem-activate', () => inactive);

import { loadUtilityGaps, proposeAccountName } from '../accounts-overview';

beforeEach(() => { vi.clearAllMocks(); inactive.cachedInactiveLineItems.mockResolvedValue([]); });

describe('proposeAccountName', () => {
  it('από τον γονικό και την κατάληξη ΦΠΑ', () => {
    expect(proposeAccountName('61.03.00.0024', 'Επεξεργασίες από τρίτους')).toBe('Επεξεργασίες από τρίτους με Φ.Π.Α. 24%');
    expect(proposeAccountName('62.02.00.0013', 'Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 9%')).toBe('Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 13%');
    expect(proposeAccountName('63.98.00.0000', 'Δημοτικά τέλη')).toBe('Δημοτικά τέλη άνευ Φ.Π.Α.');
    expect(proposeAccountName('61.03.00.0199', 'Κάτι')).toBe('Κάτι');
    expect(proposeAccountName('61.03.00.0024', null)).toBeNull();
  });
});

describe('loadUtilityGaps', () => {
  it('νερό 13%: προτείνει τον λογαριασμό που λείπει για τον ΦΠΑ των γραμμών', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{
      id: 'd1', fileName: 'ΕΥΔΑΠ.pdf', issuerAfm: '094079101', document: {},
      items: [
        { name: 'ΥΔΡΕΥΣΗ (5,00M3)', vatRate: 13, total: 1.75, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneMatchedBy: null },
        { name: 'ΥΔΡΕΥΣΗ (265,00M3)', vatRate: 13, total: 848, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneMatchedBy: null },
        { name: 'ΠΑΓΙΟ ΤΕΛΟΣ', vatRate: 24, total: 5.5, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneMatchedBy: 'skipped' },
      ],
    }]);
    db.softoneAccount.findMany.mockResolvedValue([
      { code: '62.02.00.0009', name: 'Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 9%' },
      { code: '62.02.00.0019', name: 'Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 19%' },
    ]);
    const [g] = await loadUtilityGaps();
    expect(g).toMatchObject({ kind: 'water', charge: 'consumption', lines: 2, vatRate: 13 });
    expect(g.toOpen).toEqual({ code: '62.02.00.0013', name: 'Ύδρευση παραγωγικής διαδικασίας με Φ.Π.Α. 13%', vatRate: 13 });
    expect(g.suggestions.map((s) => s.code)).toEqual(['62.02.00.0009', '62.02.00.0019']);
  });

  it('προτείνει ενεργοποίηση ανενεργής χρεοπίστωσης του ίδιου είδους, πρώτα του σωστού ΦΠΑ', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{
      id: 'd1', fileName: 'ΟΤΕ.pdf', issuerAfm: '094019245', document: {},
      items: [{ name: 'Χρέωση παγίων', vatRate: 24, total: 100, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneMatchedBy: null }],
    }]);
    db.softoneAccount.findMany.mockResolvedValue([]);
    inactive.cachedInactiveLineItems.mockResolvedValue([
      { mtrl: 1447, code: '62.03.00.0019', name: 'Τηλεφωνικά-τηλεγραφικά με Φ.Π.Α. 19%', acnmsk: '62.03.00.0019', vat: 'ΦΠΑ 19%', lisourceType: '12,13,14,15', acceptsCreditors: false },
      { mtrl: 4012, code: '62.03.00.0024', name: 'Τηλεφωνικά-τηλεγραφικά με Φ.Π.Α. 24%', acnmsk: '62.03.00.0024', vat: 'ΦΠΑ 24%', lisourceType: '12,13,14,15', acceptsCreditors: false },
      { mtrl: 1438, code: '62.00.00.0000', name: 'Ηλεκτρικό ρεύμα παραγωγής άνευ Φ.Π.Α.', acnmsk: '62.00.00.0000', vat: null, lisourceType: '12', acceptsCreditors: false },
    ]);
    const [g] = await loadUtilityGaps();
    expect(g.inactive.map((i) => i.mtrl)).toEqual([4012, 1447]);
  });

  it('υπάρχει ήδη ο λογαριασμός του ΦΠΑ: έρχεται πρώτος και δεν προτείνεται άνοιγμα', async () => {
    db.ocrDocument.findMany.mockResolvedValue([{
      id: 'd1', fileName: 'ΟΤΕ.pdf', issuerAfm: '094019245', document: {},
      items: [{ name: 'Χρέωση παγίων', vatRate: 24, total: 100, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneMatchedBy: null }],
    }]);
    db.softoneAccount.findMany.mockResolvedValue([
      { code: '62.03.00.0019', name: 'Τηλεφωνικά-τηλεγραφικά με Φ.Π.Α. 19%' },
      { code: '62.03.00.0024', name: 'Τηλεφωνικά-τηλεγραφικά με Φ.Π.Α. 24%' },
    ]);
    const [g] = await loadUtilityGaps();
    expect(g.suggestions[0].code).toBe('62.03.00.0024');
    expect(g.toOpen).toBeNull();
  });
});
