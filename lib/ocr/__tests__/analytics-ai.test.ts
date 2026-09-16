// lib/ocr/__tests__/analytics-ai.test.ts
// Πρόταση αναλυτικής (κέντρο κόστους / έργο / δραστηριότητα) με AI: μία κλήση για τα τρία,
// λευκή λίστα ανά πεδίο, κρυφή μνήμη που πιάνει ΟΛΟ το σύνολο υποψηφίων, graceful degradation.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, extract } = vi.hoisted(() => ({
  db: {
    softoneCostCenter: { findMany: vi.fn() },
    softoneProject: { findMany: vi.fn() },
    softoneProjectStage: { findMany: vi.fn() },
  },
  extract: { resolveCfg: vi.fn(), callTextLLM: vi.fn(), callTextViaVision: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../extract', () => extract);
vi.mock('@/lib/ocr/extract', () => extract);

import {
  suggestAnalyticsWithAi, parseAnalyticsAnswer, clearAnalyticsAiCache,
} from '../analytics-ai';
import { candidateSignature } from '../expense-ai';

const group = (key: string, sample: string) => ({ key, afm: '094073495', pattern: key, sample });

const answer = (o: Record<string, unknown>) => ({ content: JSON.stringify({ matches: [o] }) });

beforeEach(() => {
  vi.clearAllMocks();
  clearAnalyticsAiCache();
  db.softoneCostCenter.findMany.mockResolvedValue([{ costcntr: 3, code: 'ΚΚ01', name: 'ΠΑΡΑΓΩΓΗ' }]);
  db.softoneProject.findMany.mockResolvedValue([{ prjc: 4, code: 'ΕΡΓ1', name: 'ΕΡΓΟ Α' }]);
  db.softoneProjectStage.findMany.mockResolvedValue([{ prjcStage: 5, code: 'ΔΡ1', name: 'ΜΕΛΕΤΗ' }]);
  extract.resolveCfg.mockResolvedValue({ textKey: '', visionKey: 'k' });
  extract.callTextViaVision.mockResolvedValue(
    answer({ key: 'g1', costCntr: 'ΚΚ01', prjc: 'ΕΡΓ1', prjcStage: 'ΔΡ1', confidence: 0.8, reason: 'παραγωγή' }),
  );
});

describe('parseAnalyticsAnswer', () => {
  it('ανέχεται fences και κρατά τα null ανά πεδίο', () => {
    const r = parseAnalyticsAnswer('```json\n{"matches":[{"key":"a","costCntr":"X","prjc":null,"confidence":0.4}]}\n```');
    expect(r[0]).toMatchObject({ key: 'a', costCntr: 'X', prjc: null, prjcStage: null, confidence: 0.4 });
  });

  it('σκουπίδια → κενή λίστα', () => {
    expect(parseAnalyticsAnswer('όχι JSON')).toEqual([]);
  });
});

describe('candidateSignature', () => {
  // Το προηγούμενο σχήμα έκοβε στους ~15 πρώτους κωδικούς, οπότε μια μετονομασία βαθιά στη λίστα
  // δεν ακύρωνε τη μνήμη. Η υπογραφή πρέπει να καλύπτει ΟΛΟ το σύνολο.
  it('αλλάζει για αλλαγή στο ΤΕΛΟΣ μιας μεγάλης λίστας', () => {
    const many = Array.from({ length: 80 }, (_, i) => `id${i}:CODE${i}:NAME${i}`);
    const changed = [...many];
    changed[79] = 'id79:CODE79:ΑΛΛΟ ΟΝΟΜΑ';
    expect(candidateSignature(many)).not.toBe(candidateSignature(changed));
  });

  it('είναι σταθερή για το ίδιο σύνολο και ευαίσθητη στα όρια', () => {
    expect(candidateSignature(['a', 'b'])).toBe(candidateSignature(['a', 'b']));
    expect(candidateSignature(['ab', 'c'])).not.toBe(candidateSignature(['a', 'bc']));
  });
});

describe('suggestAnalyticsWithAi', () => {
  it('μία κλήση για τα τρία πεδία, με ετικέτες για το UI', async () => {
    const r = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΡΕΥΜΑ ΠΑΡΑΓΩΓΗΣ')] });

    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(r.suggestions[0]).toMatchObject({
      key: 'g1', costCntr: 3, prjc: 4, prjcStage: 5,
      labels: { costCntr: 'ΚΚ01 — ΠΑΡΑΓΩΓΗ', prjc: 'ΕΡΓ1 — ΕΡΓΟ Α', prjcStage: 'ΔΡ1 — ΜΕΛΕΤΗ' },
    });
    expect(extract.callTextViaVision.mock.calls[0][3]).toMatchObject({ operation: 'ocr.suggest_costcenter' });
  });

  it('κωδικός εκτός λίστας πετιέται ΑΝΑ ΠΕΔΙΟ, τα υπόλοιπα επιβιώνουν', async () => {
    extract.callTextViaVision.mockResolvedValue(
      answer({ key: 'g1', costCntr: 'ΔΕΝ-ΥΠΑΡΧΩ', prjc: 'ΕΡΓ1', prjcStage: null, confidence: 0.9 }),
    );
    const r = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.suggestions[0]).toMatchObject({ costCntr: null, prjc: 4, prjcStage: null });
  });

  it('όλα τα πεδία εκτός λίστας → καμία πρόταση για την ομάδα', async () => {
    extract.callTextViaVision.mockResolvedValue(
      answer({ key: 'g1', costCntr: 'Χ', prjc: 'Ψ', prjcStage: 'Ω', confidence: 0.9 }),
    );
    const r = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.suggestions).toEqual([]);
  });

  it('δεύτερη ερώτηση απαντιέται από τη μνήμη, χωρίς κόστος', async () => {
    await suggestAnalyticsWithAi({ groups: [group('g1', 'ΡΕΥΜΑ')] });
    const second = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΡΕΥΜΑ')] });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ asked: 0, cached: 1 });
    expect(second.suggestions).toHaveLength(1);
  });

  it('αλλαγή στο μητρώο ακυρώνει τη μνήμη', async () => {
    await suggestAnalyticsWithAi({ groups: [group('g1', 'ΡΕΥΜΑ')] });
    db.softoneCostCenter.findMany.mockResolvedValue([{ costcntr: 3, code: 'ΚΚ01', name: 'ΑΛΛΟ ΟΝΟΜΑ' }]);
    await suggestAnalyticsWithAi({ groups: [group('g1', 'ΡΕΥΜΑ')] });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(2);
  });

  it('με TRDR περιορίζει τα έργα στον εκδότη, αλλά δεν αφήνει κενή λίστα', async () => {
    db.softoneProject.findMany
      .mockResolvedValueOnce([])                                                   // κανένα έργο του εκδότη
      .mockResolvedValueOnce([{ prjc: 4, code: 'ΕΡΓ1', name: 'ΕΡΓΟ Α' }]);        // εφεδρεία: όλα
    await suggestAnalyticsWithAi({ groups: [group('g1', 'ΚΑΤΙ')], trdr: 12345 });
    expect(db.softoneProject.findMany.mock.calls[0][0].where).toMatchObject({ trdr: 12345 });
    expect(db.softoneProject.findMany).toHaveBeenCalledTimes(2);
  });

  it('κανένας πάροχος → degraded, ΟΧΙ εξαίρεση', async () => {
    extract.resolveCfg.mockResolvedValue({ textKey: 'bad', visionKey: 'k' });
    extract.callTextLLM.mockRejectedValue(new Error('401'));
    extract.callTextViaVision.mockRejectedValue(new Error('no key'));
    const r = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r).toMatchObject({ degraded: true, suggestions: [] });
  });

  it('κενά μητρώα → καμία κλήση', async () => {
    db.softoneCostCenter.findMany.mockResolvedValue([]);
    db.softoneProject.findMany.mockResolvedValue([]);
    db.softoneProjectStage.findMany.mockResolvedValue([]);
    const r = await suggestAnalyticsWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(extract.callTextViaVision).not.toHaveBeenCalled();
    expect(r.suggestions).toEqual([]);
  });
});
