// lib/ocr/__tests__/mydata-labels.test.ts
// Ο ΧΑΡΑΚΤΗΡΙΣΜΟΣ myDATA (CLASSTYPE/CLASSCATEGORY → EditLists) και η ΚΑΤΗΓΟΡΙΑ myDATA
// (MYDATACODE → enum `$s1ClassType`) είναι ΔΥΟ ΔΙΑΦΟΡΕΤΙΚΟΙ ΑΞΟΝΕΣ. Ένα join ανάμεσά τους δεν
// θα ταίριαζε ΠΟΤΕ — και θα φαινόταν «απλώς χωρίς χαρακτηρισμό», δηλαδή σιωπηλά λάθος.
// Αυτό το αρχείο κλειδώνει τον διαχωρισμό.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    softoneMyDataClassType: { findMany: vi.fn() },
    softoneMyDataClassCategory: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));

import { classificationLabeller, clearClassificationCache } from '../mydata-labels';

beforeEach(() => {
  vi.clearAllMocks();
  clearClassificationCache();
  // ΠΡΟΣΟΧΗ στα δεδομένα: το `code` είναι το κλειδί του EditList (αριθμός) και το `myDataCode`
  // το αλφαριθμητικό της ΑΑΔΕ. Το δεύτερο ΔΕΝ ταιριάζει με το `MTRL.MYDATACODE`.
  db.softoneMyDataClassType.findMany.mockResolvedValue([
    { code: 1, name: 'Έξοδα αγορών', myDataCode: 'category2_1' },
    { code: 7, name: 'Λοιπά έξοδα', myDataCode: 'category2_7' },
  ]);
  db.softoneMyDataClassCategory.findMany.mockResolvedValue([
    { code: 2, name: 'Παροχή υπηρεσιών', myDataCode: 'category2_2' },
  ]);
});

describe('classificationLabeller', () => {
  it('μεταφράζει classType / classCategory από τα ΚΛΕΙΔΙΑ των EditLists', async () => {
    const label = await classificationLabeller();
    expect(label({ classType: 1, classCategory: 2 }))
      .toEqual({ label: 'Έξοδα αγορών · Παροχή υπηρεσιών', missing: false });
  });

  it('άγνωστο κλειδί δεν εξαφανίζεται — φαίνεται ως κωδικός', async () => {
    const label = await classificationLabeller();
    expect(label({ classType: 99 }).label).toBe('Τύπος 99');
  });

  // Ο πυρήνας του θέματος: το «1» του MTRL.MYDATACODE συμπίπτει αριθμητικά με το κλειδί ενός
  // τύπου χαρακτηρισμού, αλλά ΔΕΝ είναι αυτό. Δεν επιτρέπεται να δανειστεί το όνομά του.
  it('το MYDATACODE ΔΕΝ αναζητείται στις λίστες χαρακτηρισμού', async () => {
    const label = await classificationLabeller();
    const r = label({ myDataCode: '1' });
    expect(r.label).toBe('Κατηγορία myDATA 1');
    expect(r.label).not.toContain('Έξοδα αγορών');
    expect(r.missing).toBe(false);
  });

  it('τα δύο μαζί εμφανίζονται ως ξεχωριστά κομμάτια', async () => {
    const label = await classificationLabeller();
    expect(label({ classType: 1, myDataCode: '7' }).label)
      .toBe('Έξοδα αγορών · Κατηγορία myDATA 7');
  });

  it('τίποτα στο μητρώο → missing, ώστε να βγει η προειδοποίηση', async () => {
    const label = await classificationLabeller();
    expect(label({})).toEqual({ label: null, missing: true });
    expect(label({ myDataCode: '   ' })).toEqual({ label: null, missing: true });
  });
});
