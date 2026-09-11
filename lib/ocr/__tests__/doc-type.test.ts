import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
  purchaseDocType: { findMany: vi.fn() },
  softoneDocSeries: { findMany: vi.fn() },
}));
const callTextLLM = vi.hoisted(() => vi.fn());
const callTextViaVision = vi.hoisted(() => vi.fn());
const resolveCfg = vi.hoisted(() => vi.fn(async () => ({
  textKey: 'k', textUrl: 'https://api.deepseek.com/v1/chat/completions', textModel: 'deepseek-chat',
  visionKey: 'v', visionUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', visionModel: 'gemini-2.5-flash',
})));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../extract', () => ({
  callTextLLM: (...a: unknown[]) => callTextLLM(...a),
  callTextViaVision: (...a: unknown[]) => callTextViaVision(...a),
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
  fileName: 'scan-001.pdf',
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

  it('falls back to the vision model when the text model throws (invalid DeepSeek key)', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10, items: [{ name: 'ΥΓΡΟ ΑΖΩΤΟ' }] },
      softoneKind: null, invoiceKind: null,
    }));
    callTextLLM.mockRejectedValue(new Error('DeepSeek text 401: Authentication Fails'));
    callTextViaVision.mockResolvedValue({ content: '{"code":"2061"}', model: 'gemini-2.5-flash', tokens: 90 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await classifyDocument('d1');
    expect(r).toMatchObject({ code: '2061' });
    // Ίδιο prompt, ίδιο usage label — αλλάζει μόνο το endpoint.
    const [, system, user, usage] = callTextViaVision.mock.calls[0];
    expect(system).toContain('{"code"');
    expect(user).toContain('2061');
    expect(usage).toMatchObject({ operation: 'ocr.classify_series', refType: 'OcrDocument', refId: 'd1' });
    expect(db.ocrDocument.update.mock.calls[0][0].data.seriesReason).toContain('επιλογή μοντέλου');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('text model unavailable'), expect.anything());
    warn.mockRestore();
  });

  it('uses the vision model directly when no text key is configured', async () => {
    resolveCfg.mockResolvedValueOnce({
      textKey: '', textUrl: 'https://api.deepseek.com/v1/chat/completions', textModel: 'deepseek-chat',
      visionKey: 'v', visionUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', visionModel: 'gemini-2.5-flash',
    } as never);
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10 }, softoneKind: null, invoiceKind: null,
    }));
    callTextViaVision.mockResolvedValue({ content: '{"code":"1653:1001"}', model: 'gemini-2.5-flash', tokens: 80 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await classifyDocument('d1');
    expect(r).toMatchObject({ code: '1001' });
    expect(callTextLLM).not.toHaveBeenCalled();
    expect(callTextViaVision).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('swallows a failing model call and still persists the scored winner', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', totalAmount: 10 }, softoneKind: null, invoiceKind: null,
    }));
    callTextLLM.mockRejectedValue(new Error('DeepSeek text 502'));
    callTextViaVision.mockRejectedValue(new Error('Vision text 503'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await classifyDocument('d1');
    expect(['2061', '1001']).toContain(r!.code);
    expect(db.ocrDocument.update).toHaveBeenCalledTimes(1);
    expect(db.ocrDocument.update.mock.calls[0][0].data.seriesReason).not.toContain('επιλογή μοντέλου');
    spy.mockRestore(); warn.mockRestore();
  });

  it('falls back to the file name when no printed type was read, capped at 0,6', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: '', totalAmount: 229.4 }, fileName: 'ΤΠΥ_4441.pdf',
    }));
    const r = await classifyDocument('d1');
    expect(r).toMatchObject({ code: '1001' });
    expect(r!.confidence).toBeLessThanOrEqual(0.6);
    const data = db.ocrDocument.update.mock.calls[0][0].data;
    expect(data.seriesReason).toMatch(/^από όνομα αρχείου · /);
    expect(data.seriesReason).toContain('ΤΠΥ');
    expect(data.seriesConfidence).toBeLessThanOrEqual(0.6);
  });

  it('leaves a document with no usable file-name hint on the «χωρίς τυπωμένο τύπο» path', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(doc({
      extractedData: { documentTypeLabel: '', totalAmount: 229.4 }, fileName: 'S1Prt_260129.PDF',
    }));
    const r = await classifyDocument('d1');
    const data = db.ocrDocument.update.mock.calls[0][0].data;
    expect(data.seriesReason).toContain('χωρίς τυπωμένο τύπο');
    expect(data.seriesReason).not.toContain('από όνομα αρχείου');
    expect(r!.confidence).toBeLessThan(0.6);
  });

  it('never throws when prisma rejects', async () => {
    db.ocrDocument.findUnique.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await classifyDocument('d1')).toBeNull();
    spy.mockRestore();
  });
});
