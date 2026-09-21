// lib/__tests__/tax-office.test.ts
// Δ.Ο.Υ. ΑΑΔΕ → IRSDATA του SoftOne: με ΚΩΔΙΚΟ, ακριβώς· ποτέ «περιέχει», ποτέ μαντεψιά.
import { describe, it, expect } from 'vitest';
import {
  normalizeTaxOfficeName, normalizeTaxOfficeCode, resolveTaxOffice, parseTaxOfficesResponse,
  toTaxOfficeMapping, taxOfficeMissingNote, type TaxOffice,
} from '../tax-office';

const o = (key: string, name: string, code = key, isActive = true): TaxOffice => ({ key, code, name, isActive });

/** Πραγματικές γραμμές του IRSDATA του πελάτη (GetTable, 2026-09-21), όπως γράφονται εκεί. */
const LIVE: TaxOffice[] = [
  o('1', 'ΑΓΝΩΣΤΗ ΔΟΥ'),
  o('1101', 'Α΄ ΑΘΗΝΩΝ'),
  o('1104', 'Δ΄ ΑΘΗΝΩΝ'),
  o('1112', 'ΙΒ΄ ΑΘΗΝΩΝ'),
  o('1113', 'ΙΓ΄ ΑΘΗΝΩΝ'),
  o('1117', 'ΙΖ ΑΘΗΝΩΝ'), // χωρίς κεραία — έτσι είναι στο SoftOne
  o('1130', 'ΚΑΛΛΙΘΕΑΣ'),
  o('1159', 'Φ.Α.Ε. ΑΘΗΝΩΝ'),
  o('1201', 'Α΄ΠΕΙΡΑΙΑ'), // χωρίς κενό μετά την κεραία
  o('1205', 'Ε΄ ΠΕΙΡΑΙΑ'),
  o('4211', 'Α΄ ΘΕΣΣΑΛΟΝΙΚΗΣ'),
  o('4215', 'Ε΄ ΘΕΣΣΑΛΟΝΙΚΗΣ'),
  o('4224', 'ΦΑΕ ΘΕΣΣΑΛΟΝΙΚΗΣ'),
];

describe('normalizeTaxOfficeName', () => {
  it('«ΙΖ ΑΘΗΝΩΝ» = «ΙΖ΄ ΑΘΗΝΩΝ» (κεραία, ό,τι σύμβολο κι αν είναι)', () => {
    const base = normalizeTaxOfficeName('ΙΖ ΑΘΗΝΩΝ');
    for (const v of ['ΙΖ΄ ΑΘΗΝΩΝ', "ΙΖ' ΑΘΗΝΩΝ", 'ΙΖʹ ΑΘΗΝΩΝ', 'ΙΖ’ ΑΘΗΝΩΝ', 'ΙΖ΄ΑΘΗΝΩΝ']) {
      expect(normalizeTaxOfficeName(v)).toBe(base);
    }
  });

  it('τόνοι, πεζά, πρόθεμα «Δ.Ο.Υ.», τελείες και κενά δεν μετράνε', () => {
    const base = normalizeTaxOfficeName('ΚΑΛΛΙΘΕΑΣ');
    expect(normalizeTaxOfficeName('Δ.Ο.Υ. Καλλιθέας')).toBe(base);
    expect(normalizeTaxOfficeName('ΔΟΥ  ΚΑΛΛΙΘΕΑΣ ')).toBe(base);
    expect(normalizeTaxOfficeName('Φ.Α.Ε. ΑΘΗΝΩΝ')).toBe(normalizeTaxOfficeName('ΦΑΕ ΑΘΗΝΩΝ'));
  });

  it('ελληνικά/λατινικά ομόγλυφα συγκρίνονται ίδια (ο πίνακας του doc-reference)', () => {
    // «IZ AΘHNΩN» με λατινικά I, Z, A, H, N.
    expect(normalizeTaxOfficeName('IZ AΘHNΩN')).toBe(normalizeTaxOfficeName('ΙΖ΄ ΑΘΗΝΩΝ'));
  });

  it('ΔΕΝ χαλαρώνει τίποτε άλλο: «ΙΑ ΑΘΗΝΩΝ» ≠ «Α ΑΘΗΝΩΝ»', () => {
    expect(normalizeTaxOfficeName('ΙΑ΄ ΑΘΗΝΩΝ')).not.toBe(normalizeTaxOfficeName('Α΄ ΑΘΗΝΩΝ'));
  });

  it('η λέξη «ΔΟΥ» μέσα στην ονομασία δεν κόβεται — μόνο ως πρόθεμα', () => {
    expect(normalizeTaxOfficeName('ΑΓΝΩΣΤΗ ΔΟΥ')).toContain('ΔOY');
  });
});

describe('normalizeTaxOfficeCode', () => {
  it('κενά και αρχικά μηδενικά δεν μετράνε', () => {
    expect(normalizeTaxOfficeCode(' 1190 ')).toBe('1190');
    expect(normalizeTaxOfficeCode('01101')).toBe('1101');
    expect(normalizeTaxOfficeCode(1101 as unknown as string)).toBe('1101');
  });
});

describe('resolveTaxOffice — με κωδικό', () => {
  it('ο κωδικός της ΑΑΔΕ βρίσκει τη γραμμή με το ίδιο CODE', () => {
    const r = resolveTaxOffice({ code: '1130', descr: 'ΚΑΛΛΙΘΕΑΣ' }, LIVE);
    expect(r).toMatchObject({ status: 'matched', by: 'code', office: { key: '1130', name: 'ΚΑΛΛΙΘΕΑΣ' } });
  });

  it('ο ΚΩΔΙΚΟΣ κρίνει, όχι η ονομασία (και διαφορετικό κλειδί από κωδικό δουλεύει)', () => {
    const offices = [o('77', 'Α΄ ΑΘΗΝΩΝ', '1101'), o('78', 'ΙΑ΄ ΑΘΗΝΩΝ', '1111')];
    const r = resolveTaxOffice({ code: '1111', descr: 'κάτι άσχετο' }, offices);
    expect(r).toMatchObject({ status: 'matched', by: 'code', office: { key: '78' } });
  });

  it('κωδικός που δεν υπάρχει ⇒ missing ΜΕ ΣΗΜΕΙΩΣΗ — καμία πτώση σε ονομασία', () => {
    // ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (1190): η Δ.Ο.Υ. του ίδιου του πελάτη (DGSOFT 997939640) — δεν υπάρχει στο IRSDATA.
    const r = resolveTaxOffice({ code: '1190', descr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ' }, LIVE);
    expect(r).toEqual({
      status: 'missing', reason: 'code_not_found', code: '1190', descr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ',
      note: 'Η Δ.Ο.Υ. ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (κωδ. 1190) δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.',
    });
    // Ακόμη κι αν η ονομασία ταιριάζει σε άλλη γραμμή, ο άγνωστος κωδικός ΔΕΝ «διορθώνεται».
    expect(resolveTaxOffice({ code: '9999', descr: 'ΚΑΛΛΙΘΕΑΣ' }, LIVE).status).toBe('missing');
  });

  it('ΠΟΤΕ «ΑΓΝΩΣΤΗ ΔΟΥ» (κωδ. 1) στη θέση μιας Δ.Ο.Υ. που λείπει', () => {
    const r = resolveTaxOffice({ code: '1190', descr: 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ' }, LIVE);
    expect(r.status).toBe('missing');
    expect(toTaxOfficeMapping(r)).toEqual({
      status: 'missing', by: null, office: null,
      note: 'Η Δ.Ο.Υ. ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (κωδ. 1190) δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.',
    });
  });

  it('ανενεργή Δ.Ο.Υ. ⇒ missing (inactive), όχι αντιστοίχιση', () => {
    const r = resolveTaxOffice({ code: '1130', descr: 'ΚΑΛΛΙΘΕΑΣ' }, [o('1130', 'ΚΑΛΛΙΘΕΑΣ', '1130', false)]);
    expect(r).toMatchObject({ status: 'missing', reason: 'inactive' });
  });

  it('δύο γραμμές με τον ίδιο κωδικό ⇒ δεν διαλέγουμε (εκτός αν μόνο μία είναι ενεργή)', () => {
    expect(resolveTaxOffice({ code: '1130' }, [o('1', 'Α', '1130'), o('2', 'Β', '1130')]))
      .toMatchObject({ status: 'missing', reason: 'ambiguous' });
    expect(resolveTaxOffice({ code: '1130' }, [o('1', 'Α', '1130', false), o('2', 'Β', '1130')]))
      .toMatchObject({ status: 'matched', office: { key: '2' } });
  });
});

describe('resolveTaxOffice — χωρίς κωδικό (εφεδρικά, μόνο ΑΚΡΙΒΗΣ ονομασία)', () => {
  it('ακριβής κανονικοποιημένη ονομασία ⇒ αντιστοίχιση', () => {
    expect(resolveTaxOffice({ descr: 'ΙΖ΄ ΑΘΗΝΩΝ' }, LIVE))
      .toMatchObject({ status: 'matched', by: 'name', office: { key: '1117' } });
    expect(resolveTaxOffice({ descr: 'Α΄ ΠΕΙΡΑΙΑ' }, LIVE))
      .toMatchObject({ status: 'matched', by: 'name', office: { key: '1201' } });
    expect(resolveTaxOffice({ descr: 'ΦΑΕ ΑΘΗΝΩΝ' }, LIVE))
      .toMatchObject({ status: 'matched', by: 'name', office: { key: '1159' } });
  });

  it('ΠΑΛΙΝΔΡΟΜΗΣΗ: «ΙΑ΄ ΑΘΗΝΩΝ» ΔΕΝ πάει ποτέ στην «Α΄ ΑΘΗΝΩΝ»', () => {
    const r = resolveTaxOffice({ descr: 'ΙΑ΄ ΑΘΗΝΩΝ' }, LIVE);
    expect(r).toMatchObject({ status: 'missing', reason: 'name_not_found' });
    expect(r.status === 'matched' && r.office.key).not.toBe('1101');
  });

  it('σκέτο «ΑΘΗΝΩΝ» / «ΘΕΣΣΑΛΟΝΙΚΗΣ» / «ΠΕΙΡΑΙΑ» ⇒ κανένα αυθαίρετο πρώτο ταίριασμα', () => {
    for (const d of ['ΑΘΗΝΩΝ', 'ΘΕΣΣΑΛΟΝΙΚΗΣ', 'ΠΕΙΡΑΙΑ']) {
      expect(resolveTaxOffice({ descr: d }, LIVE).status).toBe('missing');
    }
  });

  it('καμία Δ.Ο.Υ. στην πηγή ⇒ empty (τίποτα να γραφτεί ή να σβηστεί)', () => {
    expect(resolveTaxOffice({}, LIVE)).toEqual({ status: 'empty' });
    expect(resolveTaxOffice({ code: '  ', descr: null }, LIVE)).toEqual({ status: 'empty' });
    expect(toTaxOfficeMapping({ status: 'empty' })).toMatchObject({ status: 'empty', office: null, note: null });
  });
});

describe('taxOfficeMissingNote', () => {
  it('ονομάζει τη Δ.Ο.Υ. και τον κωδικό της — ή ό,τι από τα δύο ξέρουμε', () => {
    expect(taxOfficeMissingNote('code_not_found', 'ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ', '1190'))
      .toBe('Η Δ.Ο.Υ. ΚΕΦΟΔΕ ΑΤΤΙΚΗΣ (κωδ. 1190) δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.');
    expect(taxOfficeMissingNote('name_not_found', 'ΙΑ΄ ΑΘΗΝΩΝ', null))
      .toBe('Η Δ.Ο.Υ. ΙΑ΄ ΑΘΗΝΩΝ δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.');
    expect(taxOfficeMissingNote('code_not_found', null, '1190'))
      .toBe('Η Δ.Ο.Υ. (κωδ. 1190) δεν υπάρχει στο μητρώο Δ.Ο.Υ. του SoftOne.');
  });
});

describe('parseTaxOfficesResponse — ανάγνωση του IRSDATA ΚΑΤΑ ΟΝΟΜΑ στήλης', () => {
  it('η ζωντανή μορφή (IRSDATA, CODE, NAME, ISACTIVE)', () => {
    const r = parseTaxOfficesResponse({
      success: true, count: 2,
      model: [[{ name: 'IRSDATA' }, { name: 'CODE' }, { name: 'NAME' }, { name: 'ISACTIVE' }]],
      data: [['1101', '1101', 'Α΄ ΑΘΗΝΩΝ', '1'], ['1117', '1117', 'ΙΖ  ΑΘΗΝΩΝ ', '0']],
    });
    expect(r).toEqual([
      { key: '1101', code: '1101', name: 'Α΄ ΑΘΗΝΩΝ', isActive: true },
      { key: '1117', code: '1117', name: 'ΙΖ ΑΘΗΝΩΝ', isActive: false },
    ]);
  });

  it('αλλαγμένη σειρά ΚΑΙ επιπλέον στήλες ⇒ ίδιο αποτέλεσμα (ποτέ κατά θέση)', () => {
    const r = parseTaxOfficesResponse({
      success: true, count: 1,
      model: [[{ name: 'NAME' }, { name: 'ADDRESS' }, { name: 'ISACTIVE' }, { name: 'code' }, { name: 'IRSDATA' }]],
      data: [['ΚΑΛΛΙΘΕΑΣ', 'ΘΗΣΕΩΣ 1', '1', 'C1130', '77']],
    });
    expect(r).toEqual([{ key: '77', code: 'C1130', name: 'ΚΑΛΛΙΘΕΑΣ', isActive: true }]);
  });

  it('λείπει η στήλη CODE ⇒ σφάλμα (χωρίς κωδικό δεν υπάρχει ασφαλής αντιστοίχιση)', () => {
    expect(() => parseTaxOfficesResponse({
      success: true, model: [[{ name: 'IRSDATA' }, { name: 'NAME' }]], data: [['1', 'Χ']],
    })).toThrow(/CODE/);
  });

  it('«κοντή» απάντηση (count ≠ γραμμές) ⇒ σφάλμα, όχι μισό μητρώο', () => {
    expect(() => parseTaxOfficesResponse({
      success: true, count: 104,
      model: [[{ name: 'IRSDATA' }, { name: 'CODE' }, { name: 'NAME' }]], data: [['1', '1', 'Χ']],
    })).toThrow(/104/);
  });

  it('success:false ⇒ σφάλμα με το μήνυμα του SoftOne', () => {
    expect(() => parseTaxOfficesResponse({ success: false, error: 'boom' })).toThrow(/boom/);
  });

  it('απουσία ISACTIVE ⇒ ενεργή· γραμμές χωρίς κλειδί ή ονομασία πετιούνται', () => {
    const r = parseTaxOfficesResponse({
      success: true,
      model: [[{ name: 'IRSDATA' }, { name: 'CODE' }, { name: 'NAME' }]],
      data: [['1101', '1101', 'Α΄ ΑΘΗΝΩΝ'], ['', '9', 'Χ'], ['5', '5', '  ']],
    });
    expect(r).toEqual([{ key: '1101', code: '1101', name: 'Α΄ ΑΘΗΝΩΝ', isActive: true }]);
  });
});
