import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, targets, inactive } = vi.hoisted(() => ({
  db: {
    ocrDocument: { findMany: vi.fn() },
    softoneAccount: { findMany: vi.fn() },
    softoneLineItem: { findMany: vi.fn() },
    softoneExpense: { findMany: vi.fn() },
  },
  targets: vi.fn(),
  inactive: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../required-trader-kind', () => ({
  postingTargetsForSeries: targets,
  seriesKey: (r: { seriesSource: number | null; softoneSeries: string | null }) => (r.softoneSeries ? `${r.seriesSource}:${r.softoneSeries}` : null),
}));
vi.mock('@/lib/softone-sync/lineitem-activate', () => ({ cachedInactiveLineItems: inactive }));
vi.mock('../softone-match', () => ({ detectUtilityForItems: () => null }));

import { loadScanNeeds } from '../accounts-overview';

const line = (name: string, vatRate: number) => ({
  name, vatRate, total: 100, softoneMtrl: null, softoneExpn: null, softoneLinMtrl: null, softoneAsset: null, softoneMatchedBy: null,
});
const acc = (code: string, name: string, postable = true) => ({ code, name, postable, isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
  db.softoneAccount.findMany.mockResolvedValue([
    acc('62', 'Παροχές τρίτων', false), acc('62.07', 'Επισκευές και συντηρήσεις', false),
    acc('62.07.02', 'Μηχανημάτων', false), acc('62.07.02.0024', 'Μηχανημάτων με Φ.Π.Α. 24%'),
    acc('64', 'Διάφορα έξοδα', false), acc('64.00', 'Έξοδα μεταφορών', false),
    acc('64.00.00', 'Καύσιμα', false), acc('64.00.00.0024', 'Καύσιμα με Φ.Π.Α. 24%'),
    acc('61', 'Αμοιβές', false), acc('61.00', 'Αμοιβές τρίτων', false), acc('61.00.06', 'Αμοιβές λογιστών', false),
    acc('61.00.06.0024', 'Αμοιβές λογιστών με Φ.Π.Α. 24%'),
  ]);
  db.softoneExpense.findMany.mockResolvedValue([]);
  inactive.mockResolvedValue([]);
  // Δύο παραστατικά ειδικών συναλλαγών (LINLINES).
  targets.mockResolvedValue(new Map([['1653:1002', { lines: 'LINLINES' }]]));
});

describe('loadScanNeeds', () => {
  it('ομαδοποιεί ανά οικογένεια/ΦΠΑ και βρίσκει τι λείπει', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      { id: 'd1', fileName: 'a.pdf', issuerAfm: '1', document: {}, softoneSeries: '1002', seriesSource: 1653,
        items: [line('Βλάβη αντλίας', 24), line('Βλάβη γερανού', 24), line('ΚΑΥΣΙΜΑ', 6), line('Αμοιβή λογιστή', 24), line('Κάτι άγνωστο', 24)] },
    ]);
    // Χρεοπίστωση μόνο για τις αμοιβές· ανενεργή για τις επισκευές.
    db.softoneLineItem.findMany.mockResolvedValue([{ mtrl: 9, code: '61.00.06.0024', name: 'Αμοιβές λογιστών', acnmsk: '61.00.06.0024' }]);
    inactive.mockResolvedValue([{ mtrl: 4016, code: '62.07.02.0024', name: 'Επισκεύες Μηχανημάτων με Φ.Π.Α. 24%', acnmsk: '62.07.02.0024', vat: '1410', lisourceType: '12', acceptsCreditors: false }]);

    const r = await loadScanNeeds();
    const by = Object.fromEntries(r.needs.map((n) => [`${n.family}@${n.vatRate}`, n]));

    expect(by['repairs@24']).toMatchObject({ status: 'activate', lines: 2, world: 'lin' });
    expect(by['repairs@24'].inactive[0].mtrl).toBe(4016);
    expect(by['fuel@6']).toMatchObject({ status: 'open_account', toOpen: { code: '64.00.00.0006', vatRate: 6 } });
    expect(by['fees@24']).toMatchObject({ status: 'registry', registry: { kind: 'lineitem', id: 9 } });
    expect(r.unclassified).toMatchObject({ lines: 1, samples: ['Κάτι άγνωστο'] });
    // Πρώτα όσα θέλουν άνοιγμα λογαριασμού.
    expect(r.needs[0].status).toBe('open_account');
  });

  it('ο λογαριασμός υπάρχει αλλά κανένα μητρώο ⇒ create_registry', async () => {
    db.ocrDocument.findMany.mockResolvedValue([
      { id: 'd1', fileName: 'a.pdf', issuerAfm: '1', document: {}, softoneSeries: '1002', seriesSource: 1653, items: [line('Επισκευή μοτέρ', 24)] },
    ]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    const r = await loadScanNeeds();
    expect(r.needs[0]).toMatchObject({ family: 'repairs', status: 'create_registry' });
    expect(r.needs[0].suggestions[0].code).toBe('62.07.02.0024');
  });
});
