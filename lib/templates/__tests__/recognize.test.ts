// lib/templates/__tests__/recognize.test.ts — «ποιο πρότυπο είναι αυτό το έγγραφο;» (spec §14.7).
// Το ΑΦΜ νικά πάντα· μετά μιλά η διάταξη· το μοντέλο ρωτιέται ΜΟΝΟ σε ισοπαλία, και μία φορά.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  extractionTemplate: { findFirst: vi.fn(), findMany: vi.fn() },
  ocrDocument: { findUnique: vi.fn(), update: vi.fn() },
}));
const llm = vi.hoisted(() => ({ callTextLLM: vi.fn(), callTextViaVision: vi.fn(), resolveCfg: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/ocr/extract', () => llm);

import { markUnknownForm, recognizeTemplate } from '../recognize';
import { buildFingerprint } from '../fingerprint';

const KAPALINE_TEXT = 'ΜΕΤΑΦΟΡΙΚΗ ΝΑΥΛΟΣ ΔΙΑΔΡΟΜΗ ΕΜΠΟΡΕΥΜΑΤΑ ΦΟΡΤΩΤΙΚΗ ΠΡΟΟΡΙΣΜΟΣ';
const OTHER_TEXT = 'ΦΑΡΜΑΚΕΙΟ ΣΚΕΥΑΣΜΑΤΑ ΣΥΝΤΑΓΟΛΟΓΙΟ ΑΣΦΑΛΙΣΤΙΚΟ ΔΡΑΣΤΙΚΗ';

const fp = (issuerName: string, text: string) => buildFingerprint({ issuerName, afm: null, text, aspect: 1.41 });

const DOC = {
  issuerAfm: null,
  rawText: KAPALINE_TEXT,
  document: { issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: null } },
};

const candidate = (id: string, name: string, issuerName: string, text: string) => ({
  id, name, fingerprint: fp(issuerName, text), samples: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.extractionTemplate.findFirst.mockResolvedValue(null);
  db.extractionTemplate.findMany.mockResolvedValue([]);
  db.ocrDocument.findUnique.mockResolvedValue(DOC);
  db.ocrDocument.update.mockResolvedValue({});
  llm.resolveCfg.mockResolvedValue({ textKey: 'k', textUrl: 'u', textModel: 'm', visionKey: 'v' });
});

describe('recognizeTemplate', () => {
  it('answers from the ΑΦΜ before it ever looks at the layout', async () => {
    db.extractionTemplate.findFirst.mockResolvedValue({ id: 't_vat' });
    await expect(recognizeTemplate('d1', '999863881')).resolves.toEqual({ templateId: 't_vat', by: 'vat', score: null });
    expect(db.extractionTemplate.findMany).not.toHaveBeenCalled();
    expect(llm.callTextLLM).not.toHaveBeenCalled();
  });

  it('falls back to the ΑΦΜ the document already carries when the caller has none', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ ...DOC, issuerAfm: '999863881' });
    // Χωρίς ΑΦΜ από τον καλούντα η πρώτη ερώτηση δεν φτάνει καν στη βάση (`normalizeVat` → null).
    db.extractionTemplate.findFirst.mockResolvedValue({ id: 't_stored' });
    await expect(recognizeTemplate('d1')).resolves.toMatchObject({ templateId: 't_stored', by: 'vat' });
  });

  it('picks the template whose layout matches, when nothing else comes close', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([
      candidate('t_kap', 'Καπαλινέ', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
      candidate('t_far', 'Φαρμακείο', 'ΦΑΡΜΑ ΕΠΕ', OTHER_TEXT),
    ]);
    const r = await recognizeTemplate('d1');
    expect(r).toMatchObject({ templateId: 't_kap', by: 'similarity' });
    expect(r!.score).toBeGreaterThanOrEqual(0.55);
    expect(llm.callTextLLM).not.toHaveBeenCalled();
  });

  it('also ranks a template through its SAMPLES, not only its own sample', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([
      // Το ίδιο το πρότυπο δεν μοιάζει καθόλου· ένα δείγμα του όμως είναι ακριβώς αυτό το έντυπο.
      { id: 't_kap', name: 'Καπαλινέ', fingerprint: fp('ΑΣΧΕΤΗ ΕΠΩΝΥΜΙΑ', OTHER_TEXT), samples: [{ fingerprint: fp('ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT) }] },
    ]);
    await expect(recognizeTemplate('d1')).resolves.toMatchObject({ templateId: 't_kap', by: 'similarity' });
  });

  it('says «δεν ξέρω» when nothing reaches the threshold', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([candidate('t_far', 'Φαρμακείο', 'ΦΑΡΜΑ ΕΠΕ', OTHER_TEXT)]);
    await expect(recognizeTemplate('d1')).resolves.toBeNull();
    expect(llm.callTextLLM).not.toHaveBeenCalled();
  });

  it('says «δεν ξέρω» for a document that has nothing to compare on', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ issuerAfm: null, rawText: null, document: null });
    db.extractionTemplate.findMany.mockResolvedValue([candidate('t_kap', 'Καπαλινέ', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT)]);
    await expect(recognizeTemplate('d1')).resolves.toBeNull();
    expect(db.extractionTemplate.findMany).not.toHaveBeenCalled();
  });

  it('asks the text model ONCE to break a tie, and trusts only an id it offered', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([
      candidate('t_a', 'Α', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
      candidate('t_b', 'Β', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
    ]);
    llm.callTextLLM.mockResolvedValue({ content: '{"templateId":"t_b"}' });

    await expect(recognizeTemplate('d1')).resolves.toMatchObject({ templateId: 't_b', by: 'model' });
    expect(llm.callTextLLM).toHaveBeenCalledTimes(1);
    // Και τα δύο υποψήφια αναφέρονται στο prompt, με τα ονόματά τους.
    const user = llm.callTextLLM.mock.calls[0][2] as string;
    expect(user).toContain('t_a');
    expect(user).toContain('t_b');
  });

  it('stays unknown when the model invents an id', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([
      candidate('t_a', 'Α', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
      candidate('t_b', 'Β', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
    ]);
    llm.callTextLLM.mockResolvedValue({ content: '{"templateId":"t_zzz"}' });
    await expect(recognizeTemplate('d1')).resolves.toBeNull();
  });

  it('falls through to the vision endpoint when the text model is unavailable, and never throws', async () => {
    db.extractionTemplate.findMany.mockResolvedValue([
      candidate('t_a', 'Α', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
      candidate('t_b', 'Β', 'ΚΑΠΑΛΙΝΕ ΑΕ', KAPALINE_TEXT),
    ]);
    llm.callTextLLM.mockRejectedValue(new Error('401'));
    llm.callTextViaVision.mockResolvedValue({ content: '{"templateId":"t_a"}' });
    await expect(recognizeTemplate('d1')).resolves.toMatchObject({ templateId: 't_a', by: 'model' });

    llm.callTextViaVision.mockRejectedValue(new Error('no key'));
    await expect(recognizeTemplate('d1')).resolves.toBeNull();
  });

  it('answers null for a document that is gone', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    await expect(recognizeTemplate('gone')).resolves.toBeNull();
  });
});

describe('markUnknownForm', () => {
  it('adds the flag NEXT TO whatever the previous run left behind', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ reviewFlags: { review: ['Λείπει υποχρεωτικό πεδίο'], blocked: [], templateSlug: 'x' } });
    await markUnknownForm('d1');
    expect(db.ocrDocument.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { reviewFlags: { review: ['Λείπει υποχρεωτικό πεδίο'], blocked: [], templateSlug: 'x', unknownForm: true } },
    });
  });

  it('writes nothing when the flag is already there, and never throws', async () => {
    db.ocrDocument.findUnique.mockResolvedValue({ reviewFlags: { unknownForm: true } });
    await markUnknownForm('d1');
    expect(db.ocrDocument.update).not.toHaveBeenCalled();

    db.ocrDocument.findUnique.mockRejectedValue(new Error('db down'));
    await expect(markUnknownForm('d1')).resolves.toBeUndefined();
  });
});
