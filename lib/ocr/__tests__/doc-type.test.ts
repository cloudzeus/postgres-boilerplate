import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
  purchaseDocType: { findMany: vi.fn() },
  softoneDocSeries: { findMany: vi.fn() },
}));
const callTextLLM = vi.hoisted(() => vi.fn());
const resolveCfg = vi.hoisted(() => vi.fn(async () => ({ textKey: 'k', textUrl: 'https://api.deepseek.com/v1/chat/completions', textModel: 'deepseek-chat' })));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../extract', () => ({
  callTextLLM: (...a: unknown[]) => callTextLLM(...a),
  resolveCfg: () => resolveCfg(),
}));

import { classifyDocument, loadEnabledSeries } from '../doc-type';

// ---------------------------------------------------------------- fixtures

/** Ενεργοποιημένες σειρές αγορών (1251) και πιστωτών (1653) όπως τις γυρίζει η Prisma. */
const PURCHASES = [
  { code: '2061', abbrev: 'ΤΙΜΑ', name: 'Τιμολόγιο Αγοράς' },
  { code: '2081', abbrev: 'ΠΤΑ', name: 'Πιστωτικό Τιμολόγιο Αγοράς' },
];
const CREDITORS = [
  { code: '1001', abbrev: 'ΤΠΥ', name: 'Τιμολόγιο Παροχής Υπηρεσιών', sosource: 1653 },
  { code: '1002', abbrev: 'ΑΠΥ', name: 'Απόδειξη Παροχής Υπηρεσιών', sosource: 1653 },
];

const doc = (over: Record<string, unknown> = {}) => ({
  extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', totalAmount: 229.4, companyName: 'ΔΕΗ Α.Ε.' },
  softoneKind: 'Πιστωτής',
  invoiceKind: 'service',
  seriesBy: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.purchaseDocType.findMany.mockResolvedValue(PURCHASES);
  db.softoneDocSeries.findMany.mockResolvedValue(CREDITORS);
  db.ocrDocument.findUnique.mockResolvedValue(doc());
  db.ocrDocument.update.mockResolvedValue({});
});

// ---------------------------------------------------------------- tests

describe('loadEnabledSeries', () => {
  it('tags purchases with SOSOURCE 1251 and keeps the creditor SOSOURCE', async () => {
    const c = await loadEnabledSeries();
    expect(c).toHaveLength(4);
    expect(c[0]).toMatchObject({ code: '2061', kind: 'purchase', sosource: 1251 });
    expect(c[3]).toMatchObject({ code: '1002', kind: 'creditor', sosource: 1653 });
    // Μόνο ενεργοποιημένες και ενεργές σειρές, πιστωτών μόνο 1653.
    expect(db.purchaseDocType.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, isActive: true } }));
    expect(db.softoneDocSeries.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, isActive: true, sosource: 1653 } }));
  });
});

describe('classifyDocument', () => {
  it('persists the automatic result on the document', async () => {
    const r = await classifyDocument('d1');
    expect(r).toMatchObject({ code: '1001' });
    expect(r!.confidence).toBeGreaterThan(0.8);
    const data = db.ocrDocument.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ softoneSeries: '1001', seriesSource: 1653, seriesBy: 'auto' });
    expect(data.seriesReason).toContain('εκδότης πιστωτής');
    expect(callTextLLM).not.toHaveBeenCalled();
  });

  it('never overwrites a manual choice', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({ seriesBy: 'manual' }));
    expect(await classifyDocument('d1')).toBeNull();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('does nothing when no series is enabled', async () => {
    db.purchaseDocType.findMany.mockResolvedValue([]);
    db.softoneDocSeries.findMany.mockResolvedValue([]);
    expect(await classifyDocument('d1')).toBeNull();
    expect(db.ocrDocument.update).not.toHaveBeenCalled();
  });

  it('asks the model on a tie and persists the code it chose', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10, items: [{ name: 'ΥΓΡΟ ΑΖΩΤΟ' }] },
      softoneKind: null, invoiceKind: null,
    }));
    callTextLLM.mockResolvedValue({ content: '{"code":"2061"}', model: 'deepseek-chat', tokens: 120 });

    const r = await classifyDocument('d1');
    expect(r).toMatchObject({ code: '2061' });
    // Το prompt περιέχει τις εναλλακτικές σειρές και ζητά JSON.
    const [, system, user, usage] = callTextLLM.mock.calls[0];
    expect(system).toContain('{"code"');
    expect(user).toContain('2061');
    expect(user).toContain('1001');
    expect(usage).toMatchObject({ operation: 'ocr.classify_series', refType: 'OcrDocument', refId: 'd1' });
    const data = db.ocrDocument.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ softoneSeries: '2061', seriesSource: 1251, seriesBy: 'auto' });
    expect(data.seriesReason).toContain('επιλογή μοντέλου');
    expect(data.seriesConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it('keeps the scored winner when the model answers with something else', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10 }, softoneKind: null, invoiceKind: null,
    }));
    callTextLLM.mockResolvedValue({ content: '{"code":"9999"}', model: 'deepseek-chat', tokens: 10 });
    const r = await classifyDocument('d1');
    expect(['2061', '1001']).toContain(r!.code);
    expect(db.ocrDocument.update.mock.calls[0][0].data.seriesReason).not.toContain('επιλογή μοντέλου');
  });

  it('swallows a failing model call and still persists the scored winner', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10 }, softoneKind: null, invoiceKind: null,
    }));
    callTextLLM.mockRejectedValue(new Error('DeepSeek text 502'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await classifyDocument('d1');
    expect(['2061', '1001']).toContain(r!.code);
    expect(db.ocrDocument.update).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('never throws when prisma rejects', async () => {
    db.ocrDocument.findUnique.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await classifyDocument('d1')).toBeNull();
    spy.mockRestore();
  });
});
