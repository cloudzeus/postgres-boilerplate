// Ο proxy `afm2info` γυρίζει XML→JSON: τα κενά (nil) στοιχεία έρχονται ως
// ΑΝΤΙΚΕΙΜΕΝΑ. Χωρίς `textOf` κάθε πεδίο γινόταν «[object Object]».
import { describe, it, expect } from 'vitest';
import { textOf, parseAfm2Info } from '../aade-parse';

const NIL = { '@_xsi:nil': 'true' } as const;

/** Ελληνικό ΑΦΜ που υπάρχει στο μητρώο. */
const NORMAL = {
  basic_rec: {
    afm: '094073495',
    onomasia: 'ΠΑΡΑΔΕΙΓΜΑ Α.Ε.',
    doy: '1159',
    doy_descr: 'Φ.Α.Ε. ΑΘΗΝΩΝ',
    postal_address: 'ΛΕΩΦ. ΚΗΦΙΣΙΑΣ',
    postal_address_no: '10',
    postal_zip_code: '15125',
    postal_area_description: 'ΜΑΡΟΥΣΙ',
    legal_status_descr: 'ΑΕ',
    deactivation_flag: '1',
  },
  firm_act_tab: {
    item: [
      { firm_act_code: '62011000', firm_act_descr: 'ΔΕΥΤΕΡΕΥΟΥΣΑ', firm_act_kind: '2' },
      { firm_act_code: '46512000', firm_act_descr: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΛΟΓΙΣΜΙΚΟΥ', firm_act_kind: '1' },
    ],
  },
};

/** Ξένο ΑΦΜ (π.χ. DE 144960040): ΟΛΑ τα στοιχεία έρχονται nil. */
const FOREIGN_NOT_FOUND = {
  basic_rec: {
    afm: NIL, onomasia: NIL, doy_descr: {}, postal_address: {},
    postal_address_no: NIL, postal_zip_code: {}, postal_area_description: NIL,
    legal_status_descr: NIL, deactivation_flag: {},
  },
  firm_act_tab: { item: NIL },
};

describe('textOf', () => {
  it('string → trimmed, κενό → null', () => {
    expect(textOf('  ΑΘΗΝΑ ')).toBe('ΑΘΗΝΑ');
    expect(textOf('   ')).toBeNull();
  });
  it('number → η γραφή του', () => {
    expect(textOf(10)).toBe('10');
    expect(textOf(0)).toBe('0');
  });
  it('nil αντικείμενα → null, ΠΟΤΕ «[object Object]»', () => {
    expect(textOf(NIL)).toBeNull();
    expect(textOf({})).toBeNull();
    expect(textOf(null)).toBeNull();
    expect(textOf(undefined)).toBeNull();
  });
  it('αντικείμενο με κείμενο → το κείμενο', () => {
    expect(textOf({ _: ' ΑΕ ' })).toBe('ΑΕ');
    expect(textOf({ '#text': 'ΕΠΕ' })).toBe('ΕΠΕ');
    expect(textOf({ $t: 'ΟΕ' })).toBe('ΟΕ');
    expect(textOf({ '@_xsi:nil': 'true', _: 'ΙΚΕ' })).toBe('ΙΚΕ');
  });
  it('πίνακας → το πρώτο στοιχείο με κείμενο', () => {
    expect(textOf([NIL, {}, 'ΑΘΗΝΑ', 'ΠΑΤΡΑ'])).toBe('ΑΘΗΝΑ');
    expect(textOf([NIL, {}])).toBeNull();
    expect(textOf([])).toBeNull();
  });
});

describe('parseAfm2Info', () => {
  it('κανονική εγγραφή → όλα τα πεδία', () => {
    expect(parseAfm2Info(NORMAL)).toEqual({
      afm: '094073495',
      name: 'ΠΑΡΑΔΕΙΓΜΑ Α.Ε.',
      doyCode: '1159',
      doyDescr: 'Φ.Α.Ε. ΑΘΗΝΩΝ',
      profession: 'ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΛΟΓΙΣΜΙΚΟΥ',
      address: 'ΛΕΩΦ. ΚΗΦΙΣΙΑΣ 10',
      zip: '15125',
      city: 'ΜΑΡΟΥΣΙ',
      legalForm: 'ΑΕ',
      isActive: true,
    });
  });

  it('ο κωδικός Δ.Ο.Υ. (`basic_rec.doy`) κρατιέται — είναι το κλειδί της αντιστοίχισης', () => {
    const r = parseAfm2Info({ basic_rec: { afm: '997939640', onomasia: 'DGSOFT ΕΕ', doy: '1190', doy_descr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ' } });
    expect(r).toMatchObject({ doyCode: '1190', doyDescr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ' });
    // Αριθμητικός κωδικός από τον proxy → η γραφή του.
    expect(parseAfm2Info({ basic_rec: { afm: '1', onomasia: 'Χ', doy: 1101 } })?.doyCode).toBe('1101');
  });

  it('ΑΦΜ εκτός ΑΑΔΕ (όλα nil) → null, όχι εγγραφή με «[object Object]»', () => {
    expect(parseAfm2Info(FOREIGN_NOT_FOUND)).toBeNull();
  });

  it('κενή επωνυμία → null (η κάρτα δεν έχει τι να δείξει)', () => {
    expect(parseAfm2Info({ basic_rec: { afm: '094073495', onomasia: NIL } })).toBeNull();
    expect(parseAfm2Info({ basic_rec: { afm: '094073495', onomasia: '   ' } })).toBeNull();
  });

  it('χωρίς basic_rec / σκουπίδια → null', () => {
    expect(parseAfm2Info(null)).toBeNull();
    expect(parseAfm2Info({})).toBeNull();
    expect(parseAfm2Info({ basic_rec: NIL })).toBeNull();
    expect(parseAfm2Info('boom')).toBeNull();
  });

  it('ένα μόνο ΚΑΔ (αντικείμενο, όχι πίνακας) και αριθμητικό kind', () => {
    const r = parseAfm2Info({
      basic_rec: { afm: 1234, onomasia: { _: 'ΜΟΝΟ ΚΑΔ' }, deactivation_flag: 2 },
      firm_act_tab: { item: { firm_act_descr: 'ΥΠΗΡΕΣΙΕΣ', firm_act_kind: 1 } },
    });
    expect(r).toMatchObject({ afm: '1234', name: 'ΜΟΝΟ ΚΑΔ', profession: 'ΥΠΗΡΕΣΙΕΣ', isActive: false });
  });

  it('nil πεδία μιας υπαρκτής εγγραφής γίνονται null', () => {
    const r = parseAfm2Info({
      basic_rec: {
        afm: '094073495', onomasia: 'ΠΑΡΑΔΕΙΓΜΑ', doy: {}, doy_descr: NIL,
        postal_address: {}, postal_address_no: NIL, postal_zip_code: NIL,
        postal_area_description: {}, legal_status_descr: NIL, deactivation_flag: '1',
      },
      firm_act_tab: { item: [{ firm_act_descr: NIL, firm_act_kind: '1' }] },
    });
    expect(r).toEqual({
      afm: '094073495', name: 'ΠΑΡΑΔΕΙΓΜΑ', doyCode: null, doyDescr: null, profession: null,
      address: null, zip: null, city: null, legalForm: null, isActive: true,
    });
  });
});
