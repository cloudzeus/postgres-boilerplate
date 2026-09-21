// lib/ocr/__tests__/expense-ai.test.ts
// Η πρόταση δαπάνης με AI: τρέχει ΜΟΝΟ για ό,τι δεν έλυσε ο φθηνός δρόμος, σε παρτίδες, με
// λευκή λίστα κωδικών, με κρυφή μνήμη, και χωρίς να σκάει όταν δεν υπάρχει μοντέλο.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, queues, extract, ownAfm } = vi.hoisted(() => ({
  db: {
    softoneLineItem: { findMany: vi.fn() },
    softoneLineCategory: { findUnique: vi.fn(), findMany: vi.fn() },
    // Συμφραζόμενα του prompt: ποιος εκδίδει και η πραγματική ταξινομία myDATA.
    softoneTrader: { findMany: vi.fn() },
    // Το ΜΗΤΡΩΟ ΕΞΟΔΩΝ: λευκή λίστα στο prompt αντί για αφηρημένες ομάδες ΕΛΠ.
    softoneExpense: { findMany: vi.fn() },
    softoneMyDataClassType: { findMany: vi.fn() },
    softoneMyDataClassCategory: { findMany: vi.fn() },
    company: { findFirst: vi.fn() },
    // Το λογιστικό σχέδιο (εμπλουτισμός υποψηφίων) και η ΑΝΘΡΩΠΙΝΗ μνήμη (ιστορικό εκδότη).
    softoneAccount: { findMany: vi.fn() },
    lineMatchRule: { findMany: vi.fn() },
  },
  queues: { suggestForGroup: vi.fn() },
  extract: { resolveCfg: vi.fn(), callTextLLM: vi.fn(), callTextViaVision: vi.fn() },
  // Το ΑΦΜ μας: το `resolveOwnAfm` έχει δική του cache ΑΝΑ ΗΜΕΡΑ σε module-level μεταβλητή,
  // που κανένα `clearOwnCompanyCache` δεν αγγίζει — ένα test θα κλείδωνε την τιμή για όλα τα
  // επόμενα. Το mock-άρουμε ώστε κάθε test να ορίζει ρητά αν ξέρουμε ποιοι είμαστε.
  ownAfm: { resolveOwnAfm: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('../queues', () => queues);
vi.mock('./queues', () => queues);
vi.mock('@/lib/ocr/queues', () => queues);
vi.mock('../extract', () => extract);
vi.mock('@/lib/ocr/extract', () => extract);
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => ''), setSetting: vi.fn() }));
vi.mock('../own-afm', () => ownAfm);
vi.mock('@/lib/ocr/own-afm', () => ownAfm);

import {
  suggestExpensesWithAi, parseAiAnswer, clearExpenseAiCache, MAX_GROUPS, resolveAnswerKey,
} from '../expense-ai';
import { clearOwnCompanyCache } from '../own-company';

const CANDIDATES = [
  { mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ', mtrCategory: 5 },
  { mtrl: 778, code: 'ΧΡ02', name: 'ΗΛΕΚΤΡΙΚΟ ΡΕΥΜΑ', mtrCategory: 5 },
];

/** Το πραγματικό μητρώο εξόδων του ζωντανού tenant — έξι γραμμές, ολόκληρο. */
const EXPENSES = [
  { code: '100', name: 'Παρακράτηση Φόρου' },
  { code: '101', name: 'Φόρος Ανακύκλωσης' },
  { code: '102', name: 'Έξοδα Επεξεργασίας' },
  { code: '103', name: 'Μεταφορικά Αγορών' },
  { code: '104', name: 'Μεταφορικά Πωλήσεων' },
  { code: 'EFK', name: 'EFK web' },
];

const group = (key: string, sample: string) => ({ key, afm: '094073495', pattern: key, sample });

/** Καμία ντετερμινιστική πρόταση = η ομάδα φτάνει στο μοντέλο. */
const weak = [{ mtrl: null, expn: null, lin: 777, kind: 'lineitem' as const, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ', score: 0.4, by: 'name' }];

beforeEach(() => {
  vi.clearAllMocks();
  clearExpenseAiCache();
  clearOwnCompanyCache();
  db.softoneTrader.findMany.mockResolvedValue([]);
  db.softoneExpense.findMany.mockResolvedValue(EXPENSES);
  db.softoneMyDataClassType.findMany.mockResolvedValue([]);
  db.softoneMyDataClassCategory.findMany.mockResolvedValue([]);
  db.company.findFirst.mockResolvedValue(null);
  ownAfm.resolveOwnAfm.mockResolvedValue('997939640');
  queues.suggestForGroup.mockResolvedValue(weak);
  db.softoneLineItem.findMany.mockResolvedValue(CANDIDATES);
  db.softoneLineCategory.findUnique.mockResolvedValue({ name: 'ΛΕΙΤΟΥΡΓΙΚΑ' });
  db.softoneLineCategory.findMany.mockResolvedValue([{ mtrCategory: 5, name: 'ΛΕΙΤΟΥΡΓΙΚΑ' }]);
  db.softoneAccount.findMany.mockResolvedValue([]);
  db.lineMatchRule.findMany.mockResolvedValue([]);
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
    db.softoneLineItem.findMany.mockResolvedValue([
      ...CANDIDATES,
      { mtrl: 900, code: 'ΑΛΛΗ01', name: 'ΑΛΛΗΣ ΚΑΤΗΓΟΡΙΑΣ', mtrCategory: 9 },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')], categoryId: 5 });
    const user = String(extract.callTextViaVision.mock.calls[0][2]);
    expect(user).toContain('ΧΡ01 — ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ');
    expect(user).not.toContain('ΑΛΛΗ01');
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
    // Το ΧΡ02 φτάνει στη λίστα από τον δρόμο της ομοιότητας κειμένου.
    queues.suggestForGroup.mockResolvedValue([...weak, { ...weak[0], lin: 778, code: 'ΧΡ02', name: 'ΗΛΕΚΤΡΙΚΟ ΡΕΥΜΑ', score: 0.5 }]);
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
      content: '{"matches":[{"key":"g1","kind":"product","code":"","confidence":0.3,"reason":"δεν είμαι καθόλου σίγουρος"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });

    // Ο ΤΥΠΟΣ πέφτει, αλλά η αιτιολόγηση ΕΠΙΖΕΙ ως παρατήρηση: δεν επιλέγει τίποτα (ούτε τύπο
    // ούτε κωδικό) και φτάνει στον χρήστη.
    expect(r.suggestions).toEqual([
      {
        key: 'g1', kind: null, lin: null, code: null, name: null,
        confidence: 0.3, reason: 'δεν είμαι καθόλου σίγουρος', myDataType: null,
      },
    ]);
  });

  /**
   * Το prompt ΖΗΤΑΕΙ ρητά αυτή τη μορφή απάντησης για τα πάγια (χαμηλό confidence + εξήγηση στο
   * `reason`). Αν ο αγωγός την πετούσε, το prompt θα ζητούσε κάτι που δεν φτάνει ποτέ πουθενά.
   */
  it('ΠΑΓΙΟ: η απάντηση επιβιώνει ως ΠΑΡΑΤΗΡΗΣΗ και δεν επιλέγει τίποτα', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","kind":"","code":"","confidence":0.2,'
        + '"reason":"πρόκειται για πάγιο εξοπλισμό που αποσβένεται, όχι για έξοδο"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΗΛΕΚΤΡΟΝΙΚΟΣ ΥΠΟΛΟΓΙΣΤΗΣ')] });

    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({
      key: 'g1', kind: null, lin: null, code: null, name: null,
      reason: 'πρόκειται για πάγιο εξοπλισμό που αποσβένεται, όχι για έξοδο',
    });
  });

  it('αιτιολόγηση που δεν λέει τίποτα (χωρίς τύπο και κωδικό) πετιέται', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1","kind":"product","code":"","confidence":0.2,"reason":"—"}]}',
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
  // Το μοντέλο αντιγράφει συχνά ΟΛΗ τη γραμμή του prompt («<key> :: <δείγμα>») στο "key".
  // Με σκέτο Set.has() έπεφτε ΚΑΘΕ απάντηση στη λευκή λίστα — η κλήση πληρωνόταν και γύριζε
  // μηδέν προτάσεις, σιωπηλά. Επαληθεύτηκε ζωντανά με το gemini-2.5-flash.
  it('κλειδί με το δείγμα κολλημένο («<key> :: <δείγμα>») δένεται στη σωστή ομάδα', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"g1 :: ΨΩΜΙ ΧΩΡΙΑΤΙΚΟ","kind":"expense","code":"","confidence":0.9,"reason":"ομάδα 64 — έξοδα φιλοξενίας"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΨΩΜΙ ΧΩΡΙΑΤΙΚΟ')] });

    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ key: 'g1', kind: 'expense' });
  });

  it('κλειδί που ΔΕΝ είναι πρόθεμα καμιάς ερώτησης εξακολουθεί να πέφτει', async () => {
    queues.suggestForGroup.mockResolvedValue([]);
    db.softoneLineItem.findMany.mockResolvedValue([]);
    extract.callTextViaVision.mockResolvedValue({
      content: '{"matches":[{"key":"ΑΛΛΗ ΟΜΑΔΑ :: g1","kind":"expense","code":"","confidence":0.9,"reason":"ομάδα 64"}]}',
    });

    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΨΩΜΙ')] });

    expect(r.suggestions).toEqual([]);
  });
});

describe('resolveAnswerKey', () => {
  const asked = new Set(['094073495|ψωμι', '094073495|ψωμι χωριατικο']);

  it('ακριβές κλειδί περνά ως έχει', () => {
    expect(resolveAnswerKey('094073495|ψωμι', asked)).toBe('094073495|ψωμι');
  });

  it('διαλέγει το ΜΑΚΡΥΤΕΡΟ κλειδί όταν δύο είναι προθέματα της απάντησης', () => {
    expect(resolveAnswerKey('094073495|ψωμι χωριατικο :: ΨΩΜΙ', asked)).toBe('094073495|ψωμι χωριατικο');
  });

  it('άσχετο ή κενό κλειδί → null, η λευκή λίστα μένει λευκή λίστα', () => {
    expect(resolveAnswerKey('κατι αλλο', asked)).toBeNull();
    expect(resolveAnswerKey('   ', asked)).toBeNull();
  });
});

/**
 * Η γραμμή «εκδότης» του prompt δεν λέει πια σκέτο «σχέση: Προμηθευτής» — λέει ΤΙ ΣΥΝΕΠΑΓΕΤΑΙ
 * η καρτέλα υπό τα ΕΛΠ. Η σκέτη ετικέτα άφηνε το μοντέλο να μαντέψει, και μάντευε ασταθώς:
 * ίδιος εκδότης, ίδιο είδος προϊόντος, διαφορετική απάντηση ανά παρτίδα.
 */
describe('η σχέση με τον εκδότη μέσα στο prompt', () => {
  const promptText = () => String(extract.callTextViaVision.mock.calls[0][2]);

  it('καρτέλα προμηθευτή (12) ⇒ αγορά για μεταπώληση, ομάδα 2', async () => {
    db.softoneTrader.findMany.mockResolvedValue([
      { afm: '094073495', name: 'BESSEY', profession: null, sodtype: 12 },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΣΦΙΓΚΤΗΡΑΣ')] });
    expect(promptText()).toContain('ΠΡΟΜΗΘΕΥΤΗΣ');
    expect(promptText()).toContain('ομάδα 2');
  });

  it('καρτέλα πιστωτή (16) ⇒ δαπάνη/παροχή τρίτων, ομάδα 6, ΟΧΙ απόθεμα', async () => {
    db.softoneTrader.findMany.mockResolvedValue([
      { afm: '094073495', name: 'ENTERSOFT', profession: null, sodtype: 16 },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΣΥΝΤΗΡΗΣΗ')] });
    expect(promptText()).toContain('ΠΙΣΤΩΤΗΣ');
    expect(promptText()).toContain('ομάδα 6');
  });

  /**
   * Η παλιά `loadIssuers` κρατούσε την ΠΡΩΤΗ γραμμή ανά ΑΦΜ, οπότε ένας εκδότης με δύο
   * καρτέλες δήλωνε αυθαίρετα τη μία — ανάλογα με τη σειρά των εγγραφών στη βάση.
   */
  it('ΚΑΙ ΟΙ ΔΥΟ καρτέλες ⇒ το prompt λέει ρητά ότι η σχέση ΔΕΝ αποφασίζει', async () => {
    db.softoneTrader.findMany.mockResolvedValue([
      { afm: '094073495', name: 'ΔΙΠΛΗ ΑΕ', profession: null, sodtype: 12 },
      { afm: '094073495', name: 'ΔΙΠΛΗ ΑΕ', profession: null, sodtype: 16 },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('ΔΕΝ αποφασίζει');
  });

  it('χωρίς καρτέλα δεν γράφεται καθόλου «σχέση»', async () => {
    db.softoneTrader.findMany.mockResolvedValue([]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).not.toContain('σχέση:');
  });
});

/**
 * Το «προϊόν ή έξοδο;» είναι στην ουσία «για μεταπώληση ή για ανάλωση;» — και αυτό δεν
 * απαντιέται χωρίς τη δραστηριότητα του ΑΓΟΡΑΣΤΗ. Η έλλειψη πρέπει να ΦΑΙΝΕΤΑΙ.
 */
describe('η δική μας δραστηριότητα', () => {
  const promptText = () => String(extract.callTextViaVision.mock.calls[0][2]);

  it('χωρίς καρτέλα εταιρείας ⇒ ownCompanyUnknown και ΡΗΤΟ «ΑΓΝΩΣΤΗ» στο prompt', async () => {
    db.company.findFirst.mockResolvedValue(null);
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.ownCompanyUnknown).toBe(true);
    expect(promptText()).toContain('ΑΓΝΩΣΤΗ');
  });

  it('με δραστηριότητα ⇒ ownCompanyUnknown false', async () => {
    db.company.findFirst.mockResolvedValue({
      name: 'DGSOFT ΕΕ', profession: 'ΑΝΑΠΤΥΞΗ ΛΟΓΙΣΜΙΚΟΥ', gemiObjective: null, activities: [],
    });
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(r.ownCompanyUnknown).toBe(false);
  });

  /**
   * Η ΚΥΡΙΑ δραστηριότητα είναι μία και συχνά δεν είναι η εμπορική: με μόνο «ανάπτυξη
   * λογισμικού» στο prompt, ένας αγορασμένος υπολογιστής είναι — πάνω στα δεδομένα που
   * δόθηκαν — έξοδο.
   */
  it('οι ΕΜΠΟΡΙΚΟΙ ΚΑΔ (45/46/47) μπαίνουν χωριστά στο prompt', async () => {
    db.company.findFirst.mockResolvedValue({
      name: 'DGSOFT ΕΕ',
      profession: 'ΥΠΗΡΕΣΙΕΣ ΑΝΑΠΤΥΞΗΣ ΛΟΓΙΣΜΙΚΟΥ',
      gemiObjective: null,
      activities: [
        { codeAade: '62011103', codeWithoutDots: '62011103', description: 'ΑΝΑΠΤΥΞΗ ΛΟΓΙΣΜΙΚΟΥ', kind: 'PRIMARY', order: 0 },
        { codeAade: '46500000', codeWithoutDots: '46500000', description: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΕΞΟΠΛΙΣΜΟΥ ΠΛΗΡΟΦΟΡΙΚΗΣ', kind: 'SECONDARY', order: 1 },
      ],
    });
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('Εμπορικές δραστηριότητες');
    expect(promptText()).toContain('ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΕΞΟΠΛΙΣΜΟΥ ΠΛΗΡΟΦΟΡΙΚΗΣ');
    // Η κύρια (ΚΑΔ 62) ΔΕΝ είναι εμπορική και δεν μπαίνει στη λίστα μεταπώλησης.
    expect(promptText()).not.toContain('• 62011103');
  });

  it('κανένας εμπορικός ΚΑΔ ⇒ το prompt το λέει ΡΗΤΑ («δεν μεταπωλούμε»)', async () => {
    db.company.findFirst.mockResolvedValue({
      name: 'ΓΡΑΦΕΙΟ ΕΠΕ', profession: 'ΛΟΓΙΣΤΙΚΕΣ ΥΠΗΡΕΣΙΕΣ', gemiObjective: null,
      activities: [
        { codeAade: '69200000', codeWithoutDots: '69200000', description: 'ΛΟΓΙΣΤΙΚΕΣ ΥΠΗΡΕΣΙΕΣ', kind: 'PRIMARY', order: 0 },
      ],
    });
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('ΚΑΜΙΑ στο μητρώο');
  });
});

/**
 * Το μητρώο εξόδων μιας εγκατάστασης είναι ΜΙΚΡΟ — έξι γραμμές στον ζωντανό tenant — και το
 * στέλνουμε ΟΛΟΚΛΗΡΟ. Ένας κατάλογος έξι ονομάτων απαντά το «ποιο έξοδο;» πολύ πιο αξιόπιστα
 * από αφηρημένες ομάδες ΕΛΠ, που έδιναν διαφορετική απάντηση ανά παρτίδα για το ίδιο πράγμα.
 */
describe('το μητρώο εξόδων (EXPN) μέσα στο prompt', () => {
  const promptText = () => String(extract.callTextViaVision.mock.calls[0][2]);

  it('στέλνονται όλες οι γραμμές που ΙΣΧΥΟΥΝ εδώ, με κωδικό και όνομα', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΜΕΤΑΦΟΡΙΚΑ')] });
    for (const e of EXPENSES.filter((x) => x.code !== '104')) {
      expect(promptText()).toContain(`${e.code} — ${e.name}`);
    }
  });

  /**
   * Η ΠΑΓΙΔΑ: το μητρώο κρατά ζευγάρια αγορών/πωλήσεων. Η εφαρμογή καταχωρεί ΜΟΝΟ εισερχόμενα,
   * οπότε «Μεταφορικά Πωλήσεων» σε τιμολόγιο αγοράς είναι λάθος που κανείς δεν θα πρόσεχε.
   *
   * Ο έλεγχος είναι ότι η γραμμή **ΛΕΙΠΕΙ**, όχι ότι υπάρχει προειδοποίηση γι' αυτήν: μια
   * πρόταση μέσα στο prompt δεν επιβάλλει τίποτα, ενώ ό,τι δεν στάλθηκε δεν μπορεί να επιλεγεί.
   */
  it('τα έξοδα ΠΩΛΗΣΕΩΝ ΔΕΝ στέλνονται καθόλου — ούτε ο κωδικός ούτε το όνομα', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΜΕΤΑΦΟΡΙΚΑ')] });
    expect(promptText()).not.toContain('104');
    expect(promptText()).not.toContain('Μεταφορικά Πωλήσεων');
    expect(promptText()).not.toContain('ΠΩΛΗΣΕΩΝ');
    // …ενώ η πλευρά των ΑΓΟΡΩΝ είναι κανονικά εκεί.
    expect(promptText()).toContain('103 — Μεταφορικά Αγορών');
  });

  it('ασυγχρόνιστο μητρώο ⇒ το λέει, δεν σιωπά και δεν εφευρίσκει', async () => {
    db.softoneExpense.findMany.mockResolvedValue([]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('δεν έχει συγχρονιστεί');
  });
});

/**
 * Οι ΚΑΔ που δηλώνουν **μεταπώληση**. Η λίστα παρουσιάζεται στο μοντέλο ως ΚΛΕΙΣΤΗ («ΜΟΝΟ αυτά
 * μεταπωλούμε»), οπότε κάθε λάθος εδώ είναι θετικός ισχυρισμός, όχι παράλειψη.
 */
describe('επιλογή εμπορικών ΚΑΔ', () => {
  const promptText = () => String(extract.callTextViaVision.mock.calls[0][2]);
  const act = (code: string, description: string, kind = 'SECONDARY') =>
    ({ codeAade: code, codeWithoutDots: code, code, description, kind });

  const withActivities = (activities: unknown[]) => {
    db.company.findFirst.mockResolvedValue({
      name: 'ΔΟΚΙΜΗ ΕΕ', profession: 'ΚΑΤΙ', gemiObjective: null, activities,
    });
  };

  /**
   * Το `46.1` είναι «έναντι αμοιβής ή βάσει σύμβασης» — μεσίτες που ΔΕΝ αποκτούν ποτέ κυριότητα
   * των αγαθών. Τυπωμένο κάτω από «ΜΟΝΟ αυτά μεταπωλούμε» λέει το ΑΝΤΙΘΕΤΟ απ' ό,τι δηλώνει.
   */
  it('το 46.1 (εμπόριο ΕΝΑΝΤΙ ΑΜΟΙΒΗΣ) ΕΞΑΙΡΕΙΤΑΙ', async () => {
    withActivities([act('46140100', 'ΥΠΗΡΕΣΙΕΣ ΧΟΝΔΡΙΚΟΥ ΕΜΠΟΡΙΟΥ ΕΝΑΝΤΙ ΑΜΟΙΒΗΣ Η ΒΑΣΕΙ ΣΥΜΒΑΣΗΣ')]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).not.toContain('46140100');
    // …και επειδή δεν έμεινε καμία άλλη, το prompt λέει ρητά «δεν μεταπωλούμε».
    expect(promptText()).toContain('ΚΑΜΙΑ στο μητρώο');
  });

  it('το 46.5 (πραγματικό χονδρικό) ΜΕΝΕΙ', async () => {
    withActivities([act('46500000', 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΕΞΟΠΛΙΣΜΟΥ ΠΛΗΡΟΦΟΡΙΚΗΣ')]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('46500000');
  });

  /**
   * Υπάρχουν ζωντανές εταιρείες όπου ΚΑΘΕ γραμμή δραστηριότητας έχει `codeAade` και
   * `codeWithoutDots` NULL και μόνο το `code` συμπληρωμένο. Χωρίς fallback, μια εταιρεία
   * ΛΙΑΝΙΚΟΥ ΕΜΠΟΡΙΟΥ θα δηλωνόταν ως «δεν μεταπωλούμε» — ελλιπή δεδομένα ως θετικός ισχυρισμός.
   */
  it('όταν λείπουν codeAade/codeWithoutDots, διαβάζεται το code με τις τελείες', async () => {
    withActivities([
      { codeAade: null, codeWithoutDots: null, code: '47.19.10', description: 'ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ', kind: 'PRIMARY' },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ');
    expect(promptText()).not.toContain('ΚΑΜΙΑ στο μητρώο');
  });

  /** Λίστα που παρουσιάζεται ως ΚΛΕΙΣΤΗ δεν επιτρέπεται να κόβεται σιωπηλά. */
  it('όσες δεν χωράνε ΔΗΛΩΝΟΝΤΑΙ, και η ΚΥΡΙΑ μπαίνει πρώτη', async () => {
    const many = Array.from({ length: 15 }, (_, i) => act(`465000${String(i).padStart(2, '0')}`, `ΧΟΝΔΡΙΚΟ ${i}`));
    withActivities([...many, act('47191000', 'ΤΟ ΚΥΡΙΟ ΛΙΑΝΙΚΟ', 'PRIMARY')]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    expect(promptText()).toContain('ΤΟ ΚΥΡΙΟ ΛΙΑΝΙΚΟ');
    expect(promptText()).toContain('…και άλλες 4 εμπορικές δραστηριότητες');
  });
});

describe('γείωση στο λογιστικό σχέδιο', () => {
  const now = new Date('2026-09-21');
  /** ΧΡ01 με αξιόπιστο λογαριασμό· ΧΡ02 με κωδικό ΕΛΠ που δεν υπάρχει στο σχέδιο· ΚΑΥ με άλλο κλάδο. */
  const LINS = [
    { mtrl: 777, code: 'ΧΡ01', name: 'ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ', mtrCategory: 5, acnmsk: '62.04.00.0024', acnmskSyncedAt: now },
    { mtrl: 778, code: 'ΧΡ02', name: 'ΑΠΟΜΕΙΩΣΗ ΒΙΟΛΟΓΙΚΩΝ', mtrCategory: 5, acnmsk: '61.02.00.0024', acnmskSyncedAt: now },
    { mtrl: 779, code: 'ΚΑΥ', name: 'ΚΑΥΣΙΜΑ', mtrCategory: 5, acnmsk: '64.00.00.0224', acnmskSyncedAt: now },
  ];
  const ACCOUNTS = [
    { code: '62.04', name: 'Ενοίκια', postable: false, isActive: true },
    { code: '62.04.00.0024', name: 'Ενοίκια κτιρίων με ΦΠΑ 24%', postable: true, isActive: true },
    { code: '61.02', name: 'Λοιπές προμήθειες τρίτων', postable: false, isActive: true },
    { code: '64.00', name: 'Έξοδα μεταφορών', postable: false, isActive: true },
    { code: '64.00.00.0224', name: 'Έξοδα κινήσεως ΦΙΧ με ΦΠΑ 24%', postable: true, isActive: true },
  ];
  const userPrompt = (i = 0) => String(extract.callTextViaVision.mock.calls[i][2]);

  beforeEach(() => {
    db.softoneLineItem.findMany.mockResolvedValue(LINS);
    db.softoneAccount.findMany.mockResolvedValue(ACCOUNTS);
    // Καμία ομοιότητα κειμένου: ό,τι φτάνει στο μοντέλο έρχεται από το σχέδιο.
    queues.suggestForGroup.mockResolvedValue([]);
  });

  it('ο υποψήφιος με αξιόπιστο λογαριασμό φτάνει εμπλουτισμένος· ο ΕΛΠ ΟΥΤΕ φτάνει χωρίς ομοιότητα ΟΥΤΕ παίρνει κλάδο', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ ΓΡΑΦΕΙΟΥ')] });
    const user = userPrompt();
    expect(user).toContain('ΧΡ01 — ΕΝΟΙΚΙΑ ΚΤΙΡΙΩΝ [ΛΕΙΤΟΥΡΓΙΚΑ] → λογαριασμός 62.04.00.0024 «Ενοίκια κτιρίων με ΦΠΑ 24%» · κλάδος 62.04 «Ενοίκια»');
    expect(user).not.toContain('ΧΡ02');
    expect(user).not.toContain('Λοιπές προμήθειες');
  });

  it('ο ΕΛΠ που φτάνει από ομοιότητα κειμένου πάει ΜΟΝΟ με το όνομά του', async () => {
    queues.suggestForGroup.mockResolvedValue([{ mtrl: null, expn: null, lin: 778, kind: 'lineitem', code: 'ΧΡ02', name: 'ΑΠΟΜΕΙΩΣΗ ΒΙΟΛΟΓΙΚΩΝ', score: 0.4, by: 'name' }]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΚΑΤΙ')] });
    const line = userPrompt().split('\n').find((l) => l.startsWith('ΧΡ02'));
    expect(line).toBe('ΧΡ02 — ΑΠΟΜΕΙΩΣΗ ΒΙΟΛΟΓΙΚΩΝ [ΛΕΙΤΟΥΡΓΙΚΑ]');
  });

  it('ΛΕΥΚΗ ΛΙΣΤΑ: λογαριασμός ή κλάδος στη θέση του κωδικού πετιέται· κωδικός χρεοπίστωσης περνά', async () => {
    extract.callTextViaVision.mockResolvedValue({ content: JSON.stringify({ matches: [
      { key: 'g1', kind: 'lineitem', code: '62.04.00.0024', confidence: 0.9, reason: 'ενοίκιο γραφείου' },
      { key: 'g2', kind: 'lineitem', code: '62.04', confidence: 0.9, reason: 'ενοίκιο γραφείου' },
      { key: 'g3', kind: 'lineitem', code: 'ΧΡ01', confidence: 0.9, reason: 'ενοίκιο γραφείου' },
    ] }) });
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'Α'), group('g2', 'Β'), group('g3', 'Γ')] });
    const by = new Map(r.suggestions.map((s) => [s.key, s]));
    expect(by.get('g1')).toMatchObject({ lin: null, code: null });
    expect(by.get('g2')).toMatchObject({ lin: null, code: null });
    expect(by.get('g3')).toMatchObject({ lin: 777, code: 'ΧΡ01' });
  });

  it('single (προεπιλογή με λίγες αξιόπιστες): ΜΙΑ κλήση με όλες τις αξιόπιστες', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(1);
    expect(userPrompt()).toContain('ΧΡ01 —');
    expect(userPrompt()).toContain('ΚΑΥ —');
  });

  it('two-stage: ο κατάλογος έχει μόνο κλάδους με αξιόπιστη χρεοπίστωση, και το 2ο στάδιο μόνο τους επιλεγμένους', async () => {
    extract.callTextViaVision
      .mockResolvedValueOnce({ content: '{"branches":[{"key":"g1","codes":["62.04","61.02","99.99"]}]}' })
      .mockResolvedValueOnce({ content: '{"matches":[{"key":"g1","kind":"lineitem","code":"ΧΡ01","confidence":0.8,"reason":"ενοίκιο"}]}' });
    const r = await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')], strategy: 'two-stage' });

    expect(extract.callTextViaVision).toHaveBeenCalledTimes(2);
    const [stage1, stage2] = [userPrompt(0), userPrompt(1)];
    expect(stage1).toContain('62.04 «Ενοίκια»');
    expect(stage1).toContain('64.00 «Έξοδα μεταφορών»');
    expect(stage1).not.toContain('61.02');
    expect(stage2).toContain('ΧΡ01 —');
    expect(stage2).not.toContain('ΚΑΥ —');
    // Κάθε κλήση καταγράφεται χωριστά (ένα logAiUsage ανά κλήση, μέσα στον πάροχο).
    expect(extract.callTextViaVision.mock.calls[0][3]).toMatchObject({ operation: 'ocr.suggest_expense.branches' });
    expect(extract.callTextViaVision.mock.calls[1][3]).toMatchObject({ operation: 'ocr.suggest_expense' });
    expect(r.suggestions[0]).toMatchObject({ lin: 777 });
  });

  it('ιστορικό εκδότη: μόνο κανόνες με άνθρωπο, ως ένδειξη', async () => {
    db.lineMatchRule.findMany.mockResolvedValue([
      { afm: '094073495', lin: 777, createdById: 'u1' },
      { afm: '094073495', lin: 777, createdById: 'u2' },
      { afm: '094073495', lin: 779, createdById: 'u1' },
    ]);
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(db.lineMatchRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lin: { not: null }, createdById: { not: null } }),
    }));
    expect(userPrompt()).toContain('επιβεβαιωμένες από άνθρωπο γραμμές του εκδότη: 62.04 «Ενοίκια» ×2, 64.00 «Έξοδα μεταφορών» ×1');
  });

  it('χωρίς επιβεβαιωμένο ιστορικό το prompt ΔΕΝ λέει τίποτα για ιστορικό', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(userPrompt()).not.toContain('επιβεβαιωμένες');
  });

  it('αλλαγή στο ΟΝΟΜΑ του λογαριασμού ακυρώνει την κρυφή μνήμη', async () => {
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    db.softoneAccount.findMany.mockResolvedValue(ACCOUNTS.map((a) => (a.code === '62.04.00.0024' ? { ...a, name: 'Μετονομασμένος' } : a)));
    await suggestExpensesWithAi({ groups: [group('g1', 'ΕΝΟΙΚΙΟ')] });
    expect(extract.callTextViaVision).toHaveBeenCalledTimes(2);
  });
});
