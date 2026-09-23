import { describe, expect, it } from 'vitest';
import {
  TRADER_KINDS, addableTraderKinds, hasTraderCard,
  type TraderKind, type TraderKindCardRef,
} from '@/lib/ocr/trader-kind-actions';

const card = (kind: TraderKind | null): TraderKindCardRef => ({ kind });

describe('addableTraderKinds', () => {
  it('χωρίς καμία καρτέλα προσφέρει και τους τρεις τύπους', () => {
    expect(addableTraderKinds({ cards: [], missing: [] })).toEqual(['supplier', 'creditor', 'debtor']);
  });

  it('με μόνο καρτέλα προμηθευτή προσφέρει πιστωτή και χρεώστη', () => {
    expect(addableTraderKinds({ cards: [card('supplier')], missing: [] })).toEqual(['creditor', 'debtor']);
  });

  it('με καρτέλα πιστωτή προσφέρει προμηθευτή και χρεώστη', () => {
    expect(addableTraderKinds({ cards: [card('creditor')], missing: [] })).toEqual(['supplier', 'debtor']);
  });

  it('με καρτέλα χρεώστη προσφέρει προμηθευτή και πιστωτή', () => {
    expect(addableTraderKinds({ cards: [card('debtor')], missing: [] })).toEqual(['supplier', 'creditor']);
  });

  it('με δύο καρτέλες μένει μόνο ο τρίτος τύπος', () => {
    expect(addableTraderKinds({ cards: [card('supplier'), card('debtor')], missing: [] })).toEqual(['creditor']);
  });

  it('με καρτέλες και στους τρεις τύπους δεν προσφέρει τίποτα', () => {
    const cards = TRADER_KINDS.map(card);
    expect(addableTraderKinds({ cards, missing: [] })).toEqual([]);
  });

  it('τύπος που ΑΠΑΙΤΕΙΤΑΙ δεν ξαναβγαίνει ως απλή ενέργεια — κρατά την κίτρινη γραμμή του', () => {
    // Ο πιστωτής λείπει ΚΑΙ τον ζητούν παραστατικά: το κουμπί του ζει μέσα στην προειδοποίηση.
    expect(addableTraderKinds({ cards: [], missing: [{ kind: 'creditor' }] }))
      .toEqual(['supplier', 'debtor']);
  });

  it('απαιτούμενος πιστωτής + υπάρχουσα καρτέλα προμηθευτή ⇒ μόνο ο χρεώστης προσφέρεται', () => {
    expect(addableTraderKinds({ cards: [card('supplier')], missing: [{ kind: 'creditor' }] }))
      .toEqual(['debtor']);
  });

  it('δύο απαιτούμενοι τύποι αφήνουν ακριβώς τον τρίτο', () => {
    expect(addableTraderKinds({ cards: [], missing: [{ kind: 'creditor' }, { kind: 'debtor' }] }))
      .toEqual(['supplier']);
  });

  it('καρτέλα πελάτη (SODTYPE εκτός των τριών) δεν καλύπτει κανέναν τύπο', () => {
    // Το `kind: null` είναι ό,τι γράφει η ουρά για SODTYPE 13/14: ορατή καρτέλα, άσχετος τύπος.
    expect(addableTraderKinds({ cards: [card(null)], missing: [] }))
      .toEqual(['supplier', 'creditor', 'debtor']);
  });

  it('τύπος με καρτέλα δεν προσφέρεται ΠΟΤΕ, ακόμη κι αν εμφανιστεί ως απαιτούμενος', () => {
    // Αμυντικό: η ουρά δεν παράγει τέτοιο συνδυασμό, αλλά αν τον παρήγαγε, η απάντηση
    // «πρόσθεσε ξανά προμηθευτή» θα ήταν λάθος σε κάθε περίπτωση.
    expect(addableTraderKinds({ cards: [card('supplier')], missing: [{ kind: 'supplier' }] }))
      .toEqual(['creditor', 'debtor']);
  });

  it('η σειρά είναι πάντα προμηθευτής → πιστωτής → χρεώστης, ανεξάρτητα από τη σειρά εισόδου', () => {
    const a = addableTraderKinds({ cards: [], missing: [] });
    const b = addableTraderKinds({ cards: [card(null), card(null)], missing: [] });
    expect(a).toEqual([...TRADER_KINDS]);
    expect(b).toEqual([...TRADER_KINDS]);
  });

  it('δεν επιστρέφει ποτέ διπλότυπα ούτε όταν το ΑΦΜ έχει δύο καρτέλες ίδιου τύπου', () => {
    const out = addableTraderKinds({ cards: [card('creditor'), card('creditor')], missing: [] });
    expect(out).toEqual(['supplier', 'debtor']);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('hasTraderCard', () => {
  it('βλέπει την υπάρχουσα καρτέλα και αγνοεί τις άσχετες', () => {
    const cards = [card(null), card('debtor')];
    expect(hasTraderCard(cards, 'debtor')).toBe(true);
    expect(hasTraderCard(cards, 'supplier')).toBe(false);
  });

  it('κενή λίστα καρτελών σημαίνει «κανένας τύπος»', () => {
    for (const k of TRADER_KINDS) expect(hasTraderCard([], k)).toBe(false);
  });
});
