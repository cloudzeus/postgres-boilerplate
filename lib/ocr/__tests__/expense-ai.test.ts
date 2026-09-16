// lib/ocr/__tests__/expense-ai.test.ts
// Η πρόταση δαπάνης με AI: τρέχει ΜΟΝΟ για ό,τι δεν έλυσε ο φθηνός δρόμος, σε παρτίδες, με
// λευκή λίστα κωδικών, με κρυφή μνήμη, και χωρίς να σκάει όταν δεν υπάρχει μοντέλο.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, queues, extract } = vi.hoisted(() => ({
  db: {
    softoneLineItem: { findMany: vi.fn() },
    softoneLineCategory: { findUnique: vi.fn(), findMany: vi.fn() },
    // Συμφραζόμενα του prompt: ποιος εκδίδει και η πραγματική ταξινομία myDATA.
    softoneTrader: { findMany: vi.fn() },
    softoneMyDataClassType: { findMany: vi.fn() },
    softoneMyDataClassCategory: { findMany: vi.fn() },
    company: { findFirst: vi.fn() },
  },
  queues: { suggestForGroup: vi.fn() },
  extract: { resolveCfg: vi.fn(), callTextLLM: vi.fn(), callTextViaVision: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../queues', () => queues);
vi.mock('./queues', () => queues);
vi.mock('@/lib/ocr/queues', () => queues);
vi.mock('../extract', () => extract);
vi.mock('@/lib/ocr/extract', () => extract);
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => ''), setSetting: vi.fn() }));

import {
  suggestExpensesWithAi, parseAiAnswer, clearExpenseAiCache, MAX_GROUPS,
} from '../expense-ai';
import { clearOwnCompanyCache } from '../own-company';

const CANDIDATES = [
  { mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ', mtrCategory: 5 },
  { mtrl: 778, code: 'ΧΡ02', name: 'ΗΛΕΚΤΡΙΚΟ ΡΕΥΜΑ', mtrCategory: 5 },
];

const group = (key: string, sample: string) => ({ key, afm: '094073495', pattern: key, sample });

/** Καμία ντετερμινιστική πρόταση = η ομάδα φτάνει στο μοντέλο. */
const weak = [{ mtrl: null, expn: null, lin: 777, kind: 'lineitem' as const, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ', score: 0.4, by: 'name' }];

beforeEach(() => {
  vi.clearAllMocks();
  clearExpenseAiCache();
  clearOwnCompanyCache();
  db.softoneTrader.findMany.mockResolvedValue([]);
  db.softoneMyDataClassType.findMany.mockResolvedValue([]);
  db.softoneMyDataClassCategory.findMany.mockResolvedValue([]);
  db.company.findFirst.mockResolvedValue(null);
  queues.suggestForGroup.mockResolvedValue(weak);
  db.softoneLineItem.findMany.mockResolvedValue(CANDIDATES);
  db.softoneLineCategory.findUnique.mockResolvedValue({ name: 'ΛΕΙΤΟΥΡΓΙΚΑ' });
  db.softoneLineCategory.findMany.mockResolvedValue([{ mtrCategory: 5, name: 'ΛΕΙΤΟΥΡΓΙΚΑ' }]);
  extract.resolveCfg.mockResolvedValue({ textKey: '', visionKey: 'k' });
  extract.callTextViaVision.mockResolvedValue({ content: '{"matches":[{"key":"g1","code":"ΧΡ01","confidence":0.8,"reason":"ενοίκιο"}]}' });
});

describe('parseAiAnswer', () => {
  it('ανέχεται markdown fences και σκουπίδια γύρω από το JSON', () => {
    const r = parseAiAnswer('```json\n{"matches":[{"key":"a","code":"X","confidence":0.9,"reason":"γιατί"}]}\n```');
    expect(r).toEqual([{ key: 'a', kind: '', code: 'X', mydata: '', confidence: 0.9, reason: 'γιατί' }]);
  });

  it('φράζει τη βεβαιότητα στο [0,1] και δέχεται σκέτο array', () => {
    expect(parseAiAnswer('[{"key":"a","code":"X","confidence":5}]')[0].confidence).toBe(1);
    expect(parseAiAnswer('[{"key":"a","code":"X","confidence":-2}]')[0].confidence).toBe(0);
    expect(parseAiAnswer('[{"key":"a","code":"X"}]')[0].confidence).toBe(0.5);
  });

  it('σκουπίδια → κενή λίστα, ποτέ εξαίρεση', () => {
    expect(parseAiAnswer('δεν είμαι JSON')).toEqual([]);
    expect(parseAiAnswer('')).toEqual([]);
  });
});

describe('suggestExpensesWithAi', () => {
  it('ΔΕΝ καλεί μοντέλο όταν ο φθηνός δρόμος έλυσε τα πάντα', async () => {
    queues.suggestForGroup.mockResolvedValue([{ ...weak[0], score: 1, by: 'code' }]);

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ ΓΡΑΦΕΙΟΥ')] });

    expect(extract.callTextLLM).not.toHaveBeenCalled();
    expect(extract.callTextViaVision).not.toHaveBeenCalled();
    expect(r).toMatchObject({ asked: 0, skipped: 1, suggestions: [] });
  });

  it('κανόνας μνήμης μετράει ως λυμένο — δεν φτάνει ποτέ στο μοντέλο', async () => {
    queues.suggestForGroup.mockResolvedValue([{ ...weak[0], score: 0.95, by: 'memory' }]);
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(extract.callTextViaVision).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('ρωτά ΜΙΑ φορά για όλη την παρτίδα και προτείνει χρεοπίστωση', async () => {
    const r = await suggestExpensesWithAi({
      groups: [group('g1', 'ΕΝΟΙΚΙΟ ΓΡΑΦΕΙΟΥ'), group('g2', 'ΡΕΥΜΑ ΜΑΪΟΥ')],
    });

    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(r.asked).toBe(2);
    // Η απάντηση-δείγμα δεν δηλώνει `kind`: η πρόταση κρατά τον κωδικό και μένει ΧΩΡΙΣ τύπο,
    // αντί να «συμπληρώσει» έναν από μόνη της.
    expect(r.suggestions).toEqual([
      {
        key: 'g1', kind: null, lin: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ',
        confidence: 0.8, reason: 'ενοίκιο', myDataType: null,
      },
    ]);
    // Το κόστος καταγράφεται με δικό του operation ώστε να ξεχωρίζει στο /admin/ai-usage.
    expect(extract.callTextViaVision.mock.calls[0][3]).toMatchObject({ operation: 'ocr.suggest_expense' });
  });

  it('κωδικός εκτός λίστας υποψηφίων πετιέται — καμία εφευρεμένη δαπάνη', async () => {
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","code":"ΔΕΝ-ΥΠΑΡΧΩ","confidence":0.99,"reason":"τάχα"}]}',
    });
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.suggestions).toEqual([]);
  });

  it('απάντηση για ομάδα που δεν ρωτήθηκε αγνοείται', async () => {
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"ΑΛΛΗ","code":"ΧΡ01","confidence":0.9,"reason":"—"}]}',
    });
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.suggestions).toEqual([]);
  });

  it('δεύτερη ερώτηση για την ίδια ομάδα απαντιέται από τη μνήμη, χωρίς κόστος', async () => {
    const first = await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(first.suggestions).toHaveLength(1);

    const second = await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });

    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ asked: 0, cached: 1 });
    expect(second.suggestions).toHaveLength(1);
  });

  it('αλλαγή κατηγορίας ακυρώνει τη μνήμη (άλλοι υποψήφιοι, άλλη απάντηση)', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')], categoryId: 5 });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(2);
  });

  it('με επιλεγμένη κατηγορία στέλνει ΜΟΝΟ τις χρεοπιστώσεις της', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')], categoryId: 5 });
    expect(db.softoneLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, mtrCategory: 5 } }),
    );
  });

  it('κανένας πάροχος → καμία πρόταση με degraded, ΟΧΙ εξαίρεση', async () => {
    extract.resolveCfg.mockResolvedValue({ textKey: 'bad', visionKey: 'k' });
    extract.callTextLLM.mockRejectedValue(new Error('401'));
    extract.callTextViaVision.mockRejectedValue(new Error('no vision key'));

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });

    expect(r).toMatchObject({ degraded: true, suggestions: [] });
  });

  it('το κλειδί κειμένου δοκιμάζεται πρώτο και το vision είναι εφεδρεία', async () => {
    extract.resolveCfg.mockResolvedValue({ textKey: 'ok', visionKey: 'k' });
    extract.callTextLLM.mockResolvedValue({ content: '{"matches":[{"key":"g1","code":"ΧΡ02","confidence":0.7,"reason":"ρεύμα"}]}' });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΡΕΥΜΑ')] });

    expect(extract.callTextLLM).toHaveBeenCalledTimes(1);
    expect(extract.callTextViaVision).not.toHaveBeenCalled();
    expect(r.suggestions[0]).toMatchObject({ lin: 778, code: 'ΧΡ02' });
  });

  it('η παρτίδα κόβεται στο πλαφόν — ποτέ μία κλήση ανά γραμμή', async () => {
    const many = Array.from({ length: MAX_GROUPS + 7 }, (_, i) => group(`g${i}`, `ΓΡΑΜΜΗ ${i}`));
    const r = await suggestExpensesWithAi({ groups: many });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(r.asked).toBe(MAX_GROUPS);
  });

  /**
   * Άδειο μητρώο χρεοπιστώσεων ΔΕΝ ακυρώνει πια την κλήση: το ερώτημα που πονάει είναι ο
   * ΤΥΠΟΣ της γραμμής, και σε αυτό το μοντέλο απαντά χωρίς κανέναν υποψήφιο κωδικό.
   */
  it('χωρίς υποψήφιες χρεοπιστώσεις ρωτά ΜΟΝΟ για τον τύπο', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","kind":"expense","code":"","confidence":0.9,"reason":"παροχή τρίτων, ομάδα 62"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });

    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(r.suggestions).toEqual([
      {
        key: 'g1', kind: 'expense', lin: null, code: null, name: null,
        confidence: 0.9, reason: 'παροχή τρίτων, ομάδα 62', myDataType: null,
      },
    ]);
  });

  it('χαμηλή βεβαιότητα ⇒ ΚΑΝΕΝΑΣ τύπος (η ομάδα μένει «χωρίς κατηγορία»)', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","kind":"product","code":"","confidence":0.3,"reason":"δεν είμαι σίγουρος"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });

    expect(r.suggestions).toEqual([]);
  });

  it('χαρακτηρισμός myDATA εκτός λευκής λίστας πετιέται σιωπηλά', async () => {
    db.softoneMyDataClassType.findMany.mockResolvedValue([{ code: 1, name: 'Αγορές εμπορευμάτων', myDataCode: 'category2_1' }]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","kind":"expense","code":"ΧΡ01","mydata":"999","confidence":0.9,"reason":"ομάδα 62"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });

    expect(r.suggestions[0]).toMatchObject({ kind: 'expense', myDataType: null });
  });
});
