import { describe, expect, it, vi, beforeEach } from 'vitest';

const { db, queues } = vi.hoisted(() => ({
  db: {
    lineMatchRule: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    ocrInvoiceItem: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  queues: { rematchOpenDocuments: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/ocr/queues', () => queues);

import { changeRuleTarget, parseRuleKey } from '../accounting/apply-answer';

const rule = (id: string, afm: string, pattern: string, expn: number | null, lin: number | null = null) =>
  ({ id, afm, pattern, mtrl: null, expn, lin });

describe('parseRuleKey', () => {
  it('διαβάζει οικογένεια, ΦΠΑ και κόσμο', () => {
    expect(parseRuleKey('@family:fuel@24#pur')).toEqual({ base: '@family:fuel', group: 'family', name: 'fuel', vat: 24, world: 'pur' });
    expect(parseRuleKey('@utility:water:consumption')).toEqual({ base: '@utility:water:consumption', group: 'utility', name: 'water:consumption', vat: null, world: null });
    expect(parseRuleKey('αμολυβδη best value')).toBeNull();
  });
});

describe('changeRuleTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queues.rematchOpenDocuments.mockResolvedValue({ docs: 2, filled: 0 });
    db.lineMatchRule.findUnique.mockResolvedValue(rule('g', '', '@family:fuel@24#pur', 983));
  });

  it('αλλάζει τους κανόνες της ίδιας απόφασης, τους κανόνες κειμένου του εκδότη και τις χειροκίνητες γραμμές', async () => {
    db.lineMatchRule.findMany
      .mockResolvedValueOnce([
        rule('g', '', '@family:fuel@24#pur', 983),
        rule('b', '', '@family:fuel#pur', 983),            // βάση, ίδιος στόχος → αλλάζει
        rule('i', '111', '@family:fuel@24#pur', 983),      // εκδότης → αλλάζει
        rule('x', '', '@family:fuel@13#pur', 990),         // άλλος στόχος → μένει
        rule('l', '', '@family:fuel@24#lin', null, 70),    // άλλος κόσμος → μένει
      ])
      .mockResolvedValueOnce([
        rule('t1', '111', 'αμολυβδη best value', 983),     // καύσιμο του ίδιου εκδότη → αλλάζει
        rule('t2', '111', 'πλυσιμο αυτοκινητου', 983),     // όχι καύσιμο → μένει
      ]);
    db.ocrInvoiceItem.findMany.mockResolvedValue([
      { id: 'L1', name: 'ΑΜΟΛΥΒΔΗ 95', vatRate: 24, total: 50, document: { document: {}, issuerAfm: '111', items: [] } },
      { id: 'L2', name: 'DIESEL', vatRate: 13, total: 50, document: { document: {}, issuerAfm: '111', items: [] } }, // άλλος ΦΠΑ
      { id: 'L3', name: 'ΠΛΥΣΙΜΟ', vatRate: 24, total: 10, document: { document: {}, issuerAfm: '111', items: [] } }, // άλλη κατηγορία
    ]);

    const r = await changeRuleTarget('@family:fuel@24#pur', { kind: 'expense', id: 984 });

    expect(db.lineMatchRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['g', 'b', 'i', 't1'] } },
      data: expect.objectContaining({ expn: 984, lin: null, mtrl: null, targetSource: 'manual' }),
    });
    expect(db.ocrInvoiceItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['L1'] } }, data: { softoneMatchedBy: 'memory' } });
    expect(queues.rematchOpenDocuments).toHaveBeenCalledWith({ family: 'fuel' });
    expect(r).toMatchObject({ rules: 4, manualLines: 1 });
  });

  it('απορρίπτει κανόνα που δεν υπάρχει πια', async () => {
    db.lineMatchRule.findUnique.mockResolvedValue(null);
    await expect(changeRuleTarget('@family:fuel@24#pur', { kind: 'expense', id: 984 })).rejects.toThrow(/δεν υπάρχει/);
    expect(db.lineMatchRule.updateMany).not.toHaveBeenCalled();
  });
});
